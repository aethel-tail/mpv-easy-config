# mpv-easy-config · 设计与决策 v1

> 状态：已确认 · 2026-11-21
> 配套文件：`STEPS.md`（分阶段开发完成 / 验收完成判定）

## 1. 目标

自动跟踪 mpv 手册（master 分支）的更新，用**在 CI runner 内部运行的免费小模型**翻译成中文和日文，产出一个纯静态的 WebUI，让用户搜索 / 勾选 / 修改 mpv 配置项并导出 `mpv.conf`；全部部署在 GitHub Pages。

三条不可让步：

1. **零凭据**。工作流里不存在任何 API key / token（除 Actions 自带的 `GITHUB_TOKEN`，仅用于提交和发布）。因此不存在泄露导致的费用风险。
2. **纯静态**。无后端、无运行时 API 调用、无数据库。页面打开即可用。
3. **GPL 合规**。mpv 手册属 mpv 项目（GPLv2+），译文是衍生作品，必须随附许可证与署名，并声明为**非官方翻译**。

## 2. 已核实的事实（2026-11-21 实测）

| 事实 | 结论 | 影响 |
| --- | --- | --- |
| GitHub Models | 已于 2026-07-30 永久退役 | "用 GitHub 的 AI"这条路已死，改为 runner 内置模型 |
| `actions/ai-inference` | 已 Copilot-only，需订阅级 PAT | 弃用（有凭据 = 有风险） |
| `mpv.io/manual/master/` | HTTP 200，内容源为 `mpv-player/mpv@master:DOCS/man/*.rst` | 直接从 git raw 取，不爬 HTML |
| `DOCS/man/options.rst` | 410 KB，`--选项` 头 **756 个** | 选项总量的基准 |
| RST 中的元数据 | `Default:` 仅 69 处，`Choices:` **0 处** | 类型/默认值/枚举**不能**从文档取 |
| `mpv --list-options` | `m_config_frontend.c:m_config_print_option_list()` 实现，格式稳定 | 元数据的唯一可靠来源 |
| `translategemma:4b` | Ollama 官方，3.3 GB，128K ctx，55 语言（含 `zh-Hans` / `ja`），2026-01 发布 | 翻译主力模型 |
| Actions 免费额度 | 公开仓库 + 标准 runner = 免费不限分钟，20 并发 | 分片并行的成本为 0 |

`mpv --list-options` 输出格式（据此解析）：

```text
 --scale                filter (default: bilinear)
 --contrast             float (-100 to 100) (default: 0)
 --vo                   Choices: gpu gpu-next dmabuf-wayland ... (default: auto)
 --oac                  string [not in config files]
 --really-quiet         flag [not in config files]
```

字段顺序：名称（30 列对齐） → 类型名 或 `Choices: ...` → 可选 `(min to max)` → 可选 `(default: X)` → 可选标记 `[not in config files]` / `[deprecated]` / `[file]` / `for <alias>`；action 变体以缩进行跟在后面。

## 3. 架构

```text
GitHub Actions（cron 每日 03:00 UTC + 手动）
 ├─ plan     : mpv master 最近改动 DOCS/man/ 的 commit sha
 │             与 data/meta.json 比对 → 无变化则全流程终止（不下载模型）
 ├─ data     : 拉 DOCS/man/options.rst → RST 解析（描述/章节）
 │             + apt mpv → --list-options（类型/默认/范围/枚举）
 │             → 按名称合并 → site/data/options.json
 ├─ translate: plan 算出的待翻分片 → matrix[0..N-1] → Ollama(本地) → cache/{zh,ja}.json
 ├─ merge    : 合并分片产物 → 校验 → 提交 cache + data
 └─ deploy   : 发布 site/ 到 GitHub Pages
```

## 4. 数据契约

`site/data/options.json`：

```jsonc
{
  "generatedAt": "2026-11-21T03:12:00Z",
  "mpvCommit": "<40 hex>",
  "mpvVersion": "0.41.0",          // 取元数据所用的 apt 版 mpv
  "options": [ /* Option[] */ ]
}
```

`Option` 与 `Widget`（TypeScript 类型，禁止 `any`）：

```ts
type Widget =
  | { kind: "flag";    def: boolean }
  | { kind: "choice";  choices: string[]; def: string }
  | { kind: "number";  min: number | null; max: number | null; def: string }
  | { kind: "list";    def: string[] }
  | { kind: "text";    def: string };

interface OptionBase {
  name: string;        // 不含前导 --
  section: string;     // RST 一级标题（Track Selection / Video / ...）
  en: string;          // 英文描述（Markdown 子集）
  textHash: string;    // sha256(en) 前 12 位，用于增量翻译
  anchor: string;      // 形如 options-scale，用于深链到 mpv.io 手册
  file: boolean;       // [file] 标记
  deprecated: boolean; // [deprecated]
}

type Option = OptionBase & { widget: Widget };
```

规则：

- `[not in config files]` 的选项（含全部 action 变体）**不进入** `options`，mpv.conf 里写不了。
- `--list-options` 与文档任一侧缺失的选项**保留**，缺失字段降级为 `{ kind: "text" }` 并在 `data/meta.json` 记一条 `degraded[]`。
- 枚举来自 apt 版 mpv 的编译期配置，可能少于文档。UI 的下拉框必须带"自定义输入"。

`site/data/cache.<lang>.json`：`{ [textHash: string]: string }`。
译文与英文源文本解耦，相同英文共享一条译文；人工修正只要英文不变就永久生效。

## 5. 翻译层

- 模型：`translategemma:4b`（仓库变量 `TRANSLATE_MODEL` 可换）。**不往 4B 以下降级**——增速靠分片，不靠削模型。
- 一次请求 = 一个选项描述。该模型只支持 User/Assistant 角色、不做 JSON 批量输出，单条请求同时消灭了对齐风险和格式风险。
- 官方 prompt 模板（注意末尾**两个空行**再接正文，少一个空行质量下降）：

```text
You are a professional {SourceLang} ({src}) to {TargetLang} ({tgt}) translator.
Your goal is to accurately convey the meaning and nuances of the original {SourceLang}
text while adhering to {TargetLang} grammar, vocabulary, and cultural sensitivities.
Produce only the {TargetLang} translation, without any additional explanations or
commentary. Please translate the following {SourceLang} text into {TargetLang}:


{text}
```

- 语言码：`en` → `zh-Hans`、`en` → `ja`。
- **占位符保护**：翻译前把描述里的 `` `--vo=gpu` ``、URL、选项名替换为 `⟦0⟧`、`⟦1⟧` …，翻译后贴回。不依赖模型"承诺"保留字面量。
- 输出体检（全部通过才写入 cache）：
  1. 非空，且不含拒绝/元讨论（`I cannot` / `抱歉` / `as an AI`）
  2. `⟦n⟧` 占位符一个不少、顺序一致
  3. 中文 CJK 字符占比 ≥ 30%；日文必须含平假名或片假名
  4. 长度在源文长度的 0.4×–2.5× 之间
- 体检失败重试一次；再失败**不写 cache**（页面回退英文，下一轮自动重试）。

## 6. 前端

```text
src/app.ts  src/types.ts  src/mpvconf.ts  src/i18n.ts  src/*.test.ts
        │  tsc -p .        （无 bundler、无压缩、无 polyfill）
        ▼
site/app.js site/types.js site/mpvconf.js site/i18n.js   ← 提交进仓库
site/index.html  site/style.css  site/data/*.json
```

- 唯一工具链是 `typescript`（devDependency）。发布不做任何处理：线上文件 = 仓库文件。
- **版本锁定 5.9**：TypeScript 7（原生 Go 版）移除了 JS 编译器 API（`createSourceFile` / `createScanner` 均不存在），而 `no-any` 检查依赖它，故锁 `typescript@5.9`。哪天 `no-any` 有了不依赖 JS API 的实现再升级。
- import 路径写 `./mpvconf.js`（`.js` 后缀），`tsc` 原样透传，浏览器可解析。
- tsconfig 关键项：`strict`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`、`noFallthroughCasesInSwitch`、`target/module: ES2022`、`moduleResolution: Bundler`、`outDir: site`。
- **禁 `any`**：`scripts/no-any.mjs` 用 TypeScript 编译器 API 遍历 AST 找 `SyntaxKind.AnyKeyword`（精确，不误伤注释与字符串），同时禁 `@ts-ignore`、`@ts-expect-error`。CI 中 `node scripts/no-any.mjs && tsc -p .` 不过则红。
- 控件渲染用 `Widget` 判别联合做穷尽性 `switch`，`default` 分支赋 `never` 确保新增类型必须补实现。
- 渲染策略：按章节懒渲染，默认只展开第一节；搜索时按命中过滤再建 DOM。首屏 DOM < 100 节点。
- 状态：`{ values: Record<string, ...>, lang, query, expanded: Set<string> }`，`localStorage` 去抖持久化。
- 导出：只输出与默认值不同的项 → `mpv.conf`（下载 + 复制）。导入：解析现有 `mpv.conf` 回填状态，未知项列出提示而非静默丢弃。
- `buildMpvConf` / `parseMpvConf` 是纯函数并 `export`，测试用 `node --test src/*.test.ts`（Node 24 原生类型擦除，无需编译）。

## 7. CI

```yaml
permissions: { contents: write, pages: write, id-token: write }
concurrency: { group: update, cancel-in-progress: false }
on: { schedule: [{ cron: "0 3 * * *" }], workflow_dispatch: {} }
jobs:
  plan:      outputs: { pending, sha }
  translate:
    needs: [plan]
    if: needs.plan.outputs.pending != '0'
    strategy: { fail-fast: false, matrix: { shard: [0,1,2,3,4,5] } }
    timeout-minutes: 60
    # 每片先算自己待翻数，为 0 则在 ollama pull 之前 exit
  merge:     needs: [translate]   # if: always()，合并成功分片
  deploy:    needs: [merge]
```

- **没有任何 `secrets:` 段**。模型名等配置走仓库变量（`vars.*`），变量不是密钥。
- 可调旋钮：`TRANSLATE_MODEL`（默认 `translategemma:4b`）、`SHARDS`（默认 6）、`OLLAMA_NUM_PARALLEL`（默认 2）。
- job 内 `timeout-minutes` 硬上限 + 脚本 `--budget` 软预算（到点正常退出，cache 已落盘）。
- 断点续跑不需要额外机制：cache 以 `textHash` 为键并提交，中断后下一轮自然只补缺口。

## 8. 明确不做

- 后端服务、数据库、运行时 AI 调用
- 内置播放器、配置预览视频
- 配置预设市场 / 社区分享
- 手册全站翻译（只做 `options.rst` 的选项描述）
- 本机翻译流程（全部在 CI 内完成）
- CSS 框架、打包器、eslint/prettier（格式靠人工一致，真乱了再加）
- 虚拟滚动（756 项全展开若实测卡顿再加）

## 9. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| CPU 上 4B 模型吞吐估算偏 2× | 分片并行吸掉；真超时调 `SHARDS`；分片失败是部分失败，不整体失败 |
| `translategemma:4b` tag 日后被重新量化 | 首次跑通后把 digest 写入注释，必要时固定为 `translategemma:4b@sha256:...` |
| apt 版 mpv 落后于 master 文档 | 降级为文本输入，`meta.json` 记录 `mpvVersion` 与 `degraded[]`；页面标注"基于 master@sha（不稳定）" |
| 4B 模型术语不准（filter / scaler / interpolation） | 占位符保护代码字面量；cache 人工可覆盖且永久生效 |
| RST 结构变化 | 解析器带覆盖率报告，低于阈值 CI 直接红，不会静默产出残缺数据 |

## 10. 许可证

仓库使用 GPLv2+（与 mpv 手册兼容），`README.md` 与页面页脚声明：

> 本页译文基于 mpv 手册（GPLv2+）由机器翻译生成，非官方翻译。原文版权归 mpv 项目作者所有。

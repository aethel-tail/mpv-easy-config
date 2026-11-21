# mpv-easy-config · 开发步骤与完成判定

> 配套文件：`PLAN.md`（设计与决策）
> 状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 已验收

## 0. 两个"完成"的定义

必须区分，否则会出现"我觉得写完了"但没人能复现的情况。

**开发完成（Dev-Done）** — 写代码的人自己就能宣布：
- 代码写完并合入 `main`
- `tsc -p .` 与 `node scripts/no-any.mjs` 本地通过
- 没有 `TODO` / 注释掉的死代码 / 临时调试输出
- 自己按正常路径点过一遍

**验收完成（Accept-Done）** — 不依赖作者判断，任何人拿到仓库都能复现：
- 本节列出的**命令逐条执行通过**，且**数值门槛达标**
- 结果记录在 PR 描述或本文对应条目下
- CI 为绿

一个阶段只有到了 **Accept-Done** 才算结束；Dev-Done 只代表可以请别人来验。

## 1. 阶段总览

| 阶段 | 内容 | 阻塞关系 |
| --- | --- | --- |
| M0 | 仓库与工具链骨架 | 无 |
| M1 | 数据管道（RST + `--list-options`） | 依赖 M0 |
| M2 | 前端 MVP（仅英文） | 依赖 M1 的类型定义 |
| M3 | 翻译管道（CI 内 Ollama） | 依赖 M1 |
| M4 | 定时自动化 + Pages | 依赖 M2、M3 |
| M5 | 发布、合规、文档 | 依赖 M4 |

M2 与 M3 可并行（M3 只产出 `cache/*.json`，不碰前端）。

---

## M0 · 仓库与工具链骨架  `[x]`

**交付物**
- `package.json`（唯一 devDependency：`typescript`）
- `tsconfig.json`（app）、`tsconfig.scripts.json`（`allowJs + checkJs + noEmit`）
- `scripts/no-any.mjs`（AST 检查 `AnyKeyword`、`@ts-ignore`、`@ts-expect-error`）
- `src/types.ts`（`Option` / `Widget` 定义，与 `PLAN.md` §4 一致）
- `site/index.html` + `site/style.css` 空壳
- `LICENSE`（GPLv2+）、`.gitignore`

**开发完成**
- `npx tsc -p .` 通过，`site/*.js` 产出可被 `index.html` 加载并 `console.log` 出内容
- 故意写一行 `const x: any = 1`，确认 `no-any` 报错；删掉后恢复绿

**验收完成**
- [x] `npm ci && npm run check` 在干净 clone 上零错误退出（`check` = no-any + 两个 tsconfig）
- [x] 故意注入 `: any`（`.ts`）、`as any`（`.mjs`）、`// @ts-ignore`（`.ts`）各一次，三条全部被拦下、退出码 1；同文件里注释提及 `any` / `@ts-ignore` 的对照文件未被误报
- [x] 本地 `python -m http.server -d site` 打开：模块加载成功（`#app` 文案由 loading 变为骨架提示）、`style.css` 生效、footer 声明存在、唯一失败请求是预期的 `data/options.json` 404 与浏览器自带 favicon 404

---

## M1 · 数据管道  `[ ]`

**交付物**
- `scripts/fetch-manual.mjs`：取 `mpv-player/mpv@master` 的 `DOCS/man/options.rst` 与 commit sha
- `scripts/parse-rst.mjs`：RST → `{ name, section, en, anchor }[]`
- `scripts/list-options.mjs`：解析 `mpv --list-options` → `{ name, widget, def, file, deprecated }`
- `scripts/build-data.mjs`：合并 → `site/data/options.json` + `site/data/meta.json`
- `scripts/report.mjs`：打印并断言覆盖率，不达标 `exit 1`
- `src/options.test.ts`：对解析产物做结构断言

**开发完成**
- 三个脚本能串起来跑完，产出 `options.json`
- `report.mjs` 输出项数、控件分布、章节数、降级数

**验收完成**
- [ ] `node scripts/build-data.mjs && node scripts/report.mjs` 退出码 0
- [ ] `options.length >= 700`
- [ ] 非 `text` 控件（flag/choice/number/list）占比 `>= 90%`
- [ ] `section` 去重后 `>= 15` 个
- [ ] `en` 为空的选项数 `== 0`
- [ ] `meta.degraded.length / options.length <= 5%`（文档与 apt mpv 两侧缺失的总和）
- [ ] 抽查 10 个知名选项（`scale`、`vo`、`hwdec`、`sub-font-size`、`ao`、`cache`、`volume`、`alang`、`screenshot-format`、`osd-font-size`）的 `widget.def` 与 `mpv --list-options` 实际输出逐字一致
- [ ] 同一份 `options.rst` 连跑两次，产出 `options.json` 除 `generatedAt` 外完全一致（无随机序）
- [ ] `node --test src/options.test.ts` 通过

---

## M2 · 前端 MVP（仅英文）  `[ ]`

**交付物**
- `src/app.ts`：加载数据、章节树、搜索、控件渲染、状态与持久化
- `src/mpvconf.ts`：`buildMpvConf` / `parseMpvConf`（纯函数，`export`）
- `src/mpvconf.test.ts`：导入导出 round-trip
- `site/index.html`、`site/style.css` 成品

**开发完成**
- 能搜索、能改值、能导出 `mpv.conf`、能粘贴导入
- 章节懒渲染生效（未展开章节不产生 DOM）

**验收完成**
- [ ] `npx tsc -p . && node scripts/no-any.mjs` 零错误
- [ ] `node --test src/mpvconf.test.ts` 通过，round-trip 覆盖：布尔、枚举、数值带范围、列表、含空格与引号的字符串
- [ ] 首屏 DOM 节点数 `< 100`（DevTools 元素计数留证）
- [ ] 导出内容只含被修改项；未改动任何选项时导出为空字符串并给出提示
- [ ] 导入一份真实 `mpv.conf`（≥ 20 行、含注释与未知项）后，已知项值正确、未知项在界面列出且不被丢弃
- [ ] 刷新页面后改动仍在（localStorage）
- [ ] 搜索 "gpu" 能同时命中选项名与描述文本；清空搜索后恢复全量

---

## M3 · 翻译管道  `[ ]`

**交付物**
- `scripts/plan.mjs`：算待翻 `textHash` 集合、按 `--shard` 切片、输出数量
- `scripts/translate.mjs`：占位符保护 → 调本地 Ollama → 四项体检 → 写 `cache/{zh,ja}.json`
- `scripts/report-trans.mjs`：打印覆盖率与失败项
- `src/placeholder.test.ts`：占位符替换/还原、体检规则的单测

**开发完成**
- 本地能起 `ollama serve` 并跑通一条真实选项的翻译
- 单测覆盖占位符与四项体检规则

**验收完成**
- [ ] `node --test src/placeholder.test.ts` 通过
- [ ] 故意丢一个 `⟦n⟧`、故意返回英文、故意返回超短文本，三种情况都被体检拦下且**未写入 cache**
- [ ] 全量跑完后 `report-trans.mjs`：`zh` 与 `ja` 的 cache 覆盖 `>= 95%` 的 distinct `textHash`
- [ ] 同一命令重跑，新增翻译条数 `== 0`（幂等）
- [ ] 人工抽查：中英日各 20 条（挑 `vo`、`hwdec`、`scale`、`interpolation` 这类术语密集项），合格 `>= 17/20`；判据：术语合理、代码字面量未被改写、读得懂
- [ ] 任一条译文被手工修正后重跑，修正内容不被覆盖（英文源文本未变的前提下）

---

## M4 · 定时自动化与 Pages  `[ ]`

**交付物**
- `.github/workflows/update.yml`（plan → translate matrix → merge → deploy）
- `.github/workflows/check.yml`（PR 上跑 `tsc` + `no-any` + `node --test`）
- 仓库变量：`TRANSLATE_MODEL`、`SHARDS`、`OLLAMA_NUM_PARALLEL`

**开发完成**
- 手动 `workflow_dispatch` 能跑通一次全流程并提交产物
- 无变更时能正确早退

**验收完成**
- [ ] workflow 文件中 **`grep -c secrets:` 结果为 0**（除 `github.token` 外无任何凭据）
- [ ] 在 mpv 无更新的日子触发：总时长 `< 60s`，且日志中**没有** `ollama pull` 与任何推理调用
- [ ] 首轮全量（756 项 × 2 语）墙钟时间 `< 60min`
- [ ] 主动把某个选项译文从 cache 删除后触发：只重新翻译该条，其余不动
- [ ] 中途杀掉一个分片（模拟失败）：merge 仍成功、页面不崩、下一轮自动补齐缺口
- [ ] Pages URL 可访问，页面数据与仓库内 `site/data/options.json` 一致
- [ ] CI 全绿，且 `main` 上的 `site/data/` 提交历史能看出"某天 mpv 改了哪几个选项"

---

## M5 · 发布与合规  `[ ]`

**交付物**
- `README.md`：项目说明、数据来源、许可证、如何自行部署
- `site/index.html` 页脚：许可证与"非官方翻译"声明、`mpv master@<sha>` 版本标注
- `src/i18n.ts`：界面文案中/日/英三语切换

**开发完成**
- 三语文案齐全、切换即时生效
- 页脚声明与版本标注可见

**验收完成**
- [ ] `LICENSE` 存在且为 GPLv2+ 全文
- [ ] 页脚含"非官方翻译 / 原文版权归 mpv 项目"声明与当前 `mpvCommit` 前 7 位
- [ ] 界面语言切换中/日/英三态各点一遍，无残留英文硬编码（`grep` 页面源码抽查）
- [ ] 断网（DevTools offline）重新打开页面：已访问过的情况下内容仍可用（浏览器缓存），不出现空白页
- [ ] 换一台设备 / 无痕窗口打开 Pages URL，从零到导出一个可用的 `mpv.conf` 全程可完成

---

## 2. 总验收（一次性全跑）

在干净 clone 上顺序执行，全绿即项目 v1 完成：

```bash
npm ci
npx tsc -p .                          # 0 error
node scripts/no-any.mjs               # 0 finding
node --test src/                      # 全部通过
node scripts/build-data.mjs
node scripts/report.mjs               # 覆盖率门槛
node scripts/report-trans.mjs         # 覆盖率门槛
python -m http.server -d site         # 人工走一遍：搜索 / 改值 / 导出 / 导入 / 切语言
```

外加三项人工确认：
1. 页脚许可证与版本标注正确
2. 导出的 `mpv.conf` 能被真实 mpv 加载且不报 unknown option（用 `mpv --config-dir` 指向临时目录验证）
3. 抽查 20 条译文合格率 ≥ 17/20

## 3. 已知的技术债（登记在案，不阻塞 v1）

| 项 | 何时处理 |
| --- | --- |
| 无虚拟滚动，756 项全展开可能略卡 | 实测卡顿后 |
| 无 eslint/prettier | 多人协作或格式开始混乱后 |
| 译文质量依赖 4B 模型 | 出现大量术语错误且人工修正成本超过换模型时 |
| apt 版 mpv 与 master 文档的版本偏移 | 偏移导致 `degraded` 超过 5% 门槛时 |

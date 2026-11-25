import { buildConfLines, buildMpvConf, countModified, isModified, parseMpvConf } from "./mpvconf.js";
import type { Value } from "./mpvconf.js";
import type { Option, OptionsData } from "./types.js";

const STORAGE_KEY = "mpv-easy-config.v1";

type Lang = "zh" | "ja" | "en";
const LANGS: Lang[] = ["zh", "ja", "en"];
const LANG_LABELS: Record<Lang, string> = { zh: "中文", ja: "日本語", en: "English" };

/** Machine translations per language, keyed by textHash; empty until generated. */
const translations: Record<"zh" | "ja", Record<string, string>> = { zh: {}, ja: {} };

/** Translated description for an option, falling back to English. */
function describe(option: Option, lang: Lang): string {
    if (lang === "en") return option.en;
    return translations[lang][option.textHash] ?? option.en;
}
const MAX_SEARCH_HITS = 150;

/** 常用选项置顶成「推荐」一节；名字对不上当前数据时静默跳过。 */
const RECOMMENDED = [
    // 窗口与界面
    "fullscreen", "border", "ontop", "geometry", "osc", "cursor-autohide",
    // 播放行为
    "keep-open", "loop-file", "save-position-on-quit", "speed",
    // 视频
    "vo", "hwdec", "scale", "deband", "video-zoom", "vf",
    // 音频
    "ao", "volume", "mute", "af",
    // 轨道与语言
    "aid", "sid", "alang", "slang",
    // 字幕
    "sub-visibility", "sub-font-size",
    // 其他
    "cache", "cache-secs", "screenshot-format", "profile",
];

interface State {
    values: Record<string, Value>;
    query: string;
    lang: Lang;
}

function el(tag: string, className = "", text?: string): HTMLElement {
    const node = document.createElement(tag);
    if (className !== "") node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function must<T extends Element>(selector: string): T {
    const found = document.querySelector<T>(selector);
    if (found === null) throw new Error(`missing ${selector}`);
    return found;
}

const INLINE_RULES: [RegExp, string][] = [
    [/`([^`]+)`/g, "<code>$1</code>"],
    [/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"],
    [/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>'],
];

/** Renders the Markdown subset the data pipeline emits. Input is escaped first. */
function inline(text: string): string {
    let html = text.replace(/[&<>]/g, (char) => `&#${char.charCodeAt(0)};`);
    for (const [pattern, replacement] of INLINE_RULES) html = html.replace(pattern, replacement);
    return html;
}

function description(text: string): DocumentFragment {
    const fragment = document.createDocumentFragment();
    for (const block of text.split(/\n{2,}/)) {
        const lines = block.split("\n").filter((line) => line !== "");
        if (lines.length > 0 && lines.every((line) => line.startsWith("- "))) {
            const list = el("ul");
            for (const line of lines) {
                const item = el("li");
                item.innerHTML = inline(line.slice(2));
                list.append(item);
            }
            fragment.append(list);
            continue;
        }
        const paragraph = el("p");
        paragraph.innerHTML = inline(block);
        fragment.append(paragraph);
    }
    return fragment;
}

function store(state: State): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.values));
}

function load(): Record<string, Value> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return {};
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, Value>) : {};
    } catch {
        return {};
    }
}

/** Machine translations live next to the data and are optional: a missing file just
 * means every description falls back to English. */
async function loadTranslations(lang: string): Promise<Record<string, string>> {
    try {
        const res = await fetch(`./data/trans.${lang}.json`, { cache: "no-cache" });
        if (!res.ok) return {};
        return (await res.json()) as Record<string, string>;
    } catch {
        return {};
    }
}

function setValue(state: State, name: string, value: Value, def: Value): void {
    if (value === def) delete state.values[name];
    else state.values[name] = value;
    store(state);
}

interface Control {
    node: HTMLElement;
    /** Refreshes the widget's displayed value from state (also registered per-row for duplicated options). */
    sync: () => void;
}

function control(option: Option, state: State, changed: () => void): Control {
    const widget = option.widget;
    const current = () => state.values[option.name] ?? widget.def;
    const write = (next: Value) => {
        setValue(state, option.name, next, widget.def);
        changed();
    };

    switch (widget.kind) {
        case "flag": {
            const box = el("input") as HTMLInputElement;
            box.type = "checkbox";
            box.addEventListener("change", () => write(box.checked));
            const sync = () => {
                box.checked = current() === true;
            };
            sync();
            return { node: box, sync };
        }
        case "choice": {
            // A strict select: the choices come from one specific build, so an imported
            // value outside the list gets an extra entry rather than being hidden.
            const select = el("select") as HTMLSelectElement;
            for (const choice of widget.choices) {
                const item = el("option") as HTMLOptionElement;
                item.value = choice;
                item.textContent = choice === widget.def ? `${choice}（默认）` : choice;
                select.append(item);
            }
            const ensureOption = (value: string) => {
                if (value !== "" && ![...select.options].some((item) => item.value === value)) {
                    const extra = el("option") as HTMLOptionElement;
                    extra.value = value;
                    extra.textContent = `${value}（当前值）`;
                    select.append(extra);
                }
            };
            const sync = () => {
                const value = String(current());
                ensureOption(value);
                select.value = value;
                select.classList.toggle("dirty", value !== widget.def);
            };
            select.addEventListener("change", () => write(select.value));
            sync();
            return { node: select, sync };
        }
        case "number": {
            const box = el("input") as HTMLInputElement;
            box.type = "number";
            box.step = "any";
            if (widget.min !== null) box.min = String(widget.min);
            if (widget.max !== null) box.max = String(widget.max);
            box.addEventListener("input", () => write(box.value));
            const sync = () => {
                box.value = String(current());
            };
            sync();
            return { node: box, sync };
        }
        case "list":
        case "text": {
            const box = el("input") as HTMLInputElement;
            box.type = "text";
            if (widget.kind === "list") box.placeholder = "逗号分隔";
            if (option.file) box.placeholder = "文件路径";
            box.addEventListener("input", () => write(box.value));
            const sync = () => {
                box.value = String(current());
            };
            sync();
            return { node: box, sync };
        }
        default: {
            const unhandled: never = widget;
            throw new Error(`unhandled widget ${JSON.stringify(unhandled)}`);
        }
    }
}

const sectionId = (section: string): string =>
    section === "推荐" ? "sec-recommended" : `sec-${section.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export async function boot(): Promise<void> {
    const list = must<HTMLElement>("#options");
    const scroller = must<HTMLElement>("#scroller");
    const sections = must<HTMLElement>("#sections");
    const search = must<HTMLInputElement>("#search");
    const status = must<HTMLElement>("#status");
    const version = must<HTMLElement>("#version");
    const confView = must<HTMLElement>("#conf-view");
    const copyButton = must<HTMLButtonElement>("#copy");
    const downloadButton = must<HTMLButtonElement>("#download");

    const res = await fetch("./data/options.json", { cache: "no-cache" });
    if (!res.ok) {
        list.textContent = "数据尚未生成（options.json 缺失）";
        return;
    }
    const data = (await res.json()) as OptionsData;
    translations.zh = await loadTranslations("zh");
    translations.ja = await loadTranslations("ja");
    const state: State = { values: load(), query: "", lang: "zh" };

    const bySection = new Map<string, Option[]>();
    for (const option of data.options) {
        const bucket = bySection.get(option.section);
        if (bucket === undefined) bySection.set(option.section, [option]);
        else bucket.push(option);
    }
    // 「推荐」置顶；与原章节共享同一份 Option 对象，值仍按名字存取
    const menuSections = new Map<string, Option[]>();
    const recommended = RECOMMENDED.map((name) => data.options.find((o) => o.name === name)).filter(
        (o): o is Option => o !== undefined,
    );
    if (recommended.length > 0) menuSections.set("推荐", recommended);
    for (const [name, bucket] of bySection) menuSections.set(name, bucket);
    const sectionNames = [...menuSections.keys()];

    // 同一选项可能出现在「推荐」和原章节两处，改一处要同步另一处的控件与徽章
    const rowSyncs = new Map<string, Set<() => void>>();
    const syncRows = (name: string) => {
        for (const fn of rowSyncs.get(name) ?? []) fn();
    };

    const header = `mpv-easy-config · mpv master@${data.mpvCommit.slice(0, 7)}`;

    version.textContent = `mpv master@${data.mpvCommit.slice(0, 7)} · ${data.options.length} 项`;
    version.title = `${data.mpvVersion}，生成于 ${data.generatedAt}`;

    const refreshStatus = () => {
        const changed = countModified(data.options, state.values);
        status.textContent = changed === 0 ? "未修改" : `${changed} 项修改`;
    };

    // ===== 左侧：conf 实时预览 =====
    const renderConf = () => {
        const lines = buildConfLines(data.options, state.values);
        copyButton.hidden = lines.length === 0;
        downloadButton.hidden = lines.length === 0;
        confView.replaceChildren();
        if (lines.length === 0) {
            confView.append(el("span", "empty", "# 还没有改动任何选项。\n# 在右侧修改后，这里会实时生成 mpv.conf 内容。"));
            return;
        }
        confView.append(el("span", "conf-comment", `# ${header}`), "\n");
        for (const line of lines) {
            const lineEl = el("span", "conf-line");
            if (line.flag) {
                lineEl.append(el("span", line.on ? "k" : "flag-no", line.text));
            } else {
                const eq = line.text.indexOf("=");
                lineEl.append(
                    el("span", "k", line.text.slice(0, eq)),
                    el("span", "eq", "="),
                    el("span", "v", line.text.slice(eq + 1)),
                );
            }
            confView.append(lineEl, "\n");
        }
    };

    // ===== 右侧：选项行 =====
    const optionRow = (option: Option): HTMLElement => {
        const row = el("div", "row");
        const badge = el("span", "badge", "已修改");
        const markRow = () => {
            const modified = isModified(option, state.values);
            row.classList.toggle("modified", modified);
            badge.hidden = !modified;
        };
        markRow();

        const head = el("div", "row-head");
        const name = el("code", "opt-name", option.name);
        if (option.deprecated) name.classList.add("deprecated");
        head.append(name, badge, el("span", "spacer"));
        const resetButton = el("button", "reset-row", "↺") as HTMLButtonElement;
        resetButton.type = "button";
        resetButton.title = "重置为默认值";
        resetButton.addEventListener("click", () => {
            delete state.values[option.name];
            store(state);
            syncRows(option.name);
            renderConf();
            refreshStatus();
        });
        head.append(resetButton);

        const body = el("div", "row-body");
        const defaultLabel = option.widget.kind === "flag" ? (option.widget.def ? "是" : "否") : option.widget.def || "空";
        body.append(el("span", "default", `默认 ${defaultLabel}`));
        // Row-local updates only: with the full list rendered, a whole-list
        // re-render per keystroke would lose focus and crawl.
        const { node, sync } = control(option, state, () => {
            syncRows(option.name);
            renderConf();
            refreshStatus();
        });
        const rowSync = () => {
            sync();
            markRow();
        };
        const syncSet = rowSyncs.get(option.name) ?? new Set<() => void>();
        syncSet.add(rowSync);
        rowSyncs.set(option.name, syncSet);
        body.append(node);

        const text = el("div", "desc");
        text.append(description(describe(option, state.lang)));

        row.append(head, body, text);
        return row;
    };

    const matches = (option: Option): boolean => {
        const query = state.query.toLowerCase();
        const localized = LANGS.map((lang) => describe(option, lang)).join(" ").toLowerCase();
        return (
            option.name.toLowerCase().includes(query) ||
            option.en.toLowerCase().includes(query) ||
            localized.includes(query)
        );
    };

    const renderList = () => {
        rowSyncs.clear();
        if (state.query !== "") {
            const hits = data.options.filter(matches).slice(0, MAX_SEARCH_HITS);
            list.replaceChildren(el("h2", "list-title", `搜索 “${state.query}” · ${hits.length} 个结果`));
            for (const option of hits) {
                const group = el("div", "hit");
                group.append(el("span", "hit-section", option.section));
                group.append(optionRow(option));
                list.append(group);
            }
            return;
        }
        const nodes: HTMLElement[] = [];
        for (const name of sectionNames) {
            const heading = el("h2", "section-title");
            heading.id = sectionId(name);
            heading.dataset["section"] = name;
            heading.append(el("span", "", name));
            heading.append(el("span", "count", `${menuSections.get(name)?.length ?? 0} 项`));
            nodes.push(heading);
            for (const option of menuSections.get(name) ?? []) {
                if (name === "推荐") {
                    // 推荐是镜像，标出原章节方便找回
                    const group = el("div", "hit");
                    group.append(el("span", "hit-section", option.section));
                    group.append(optionRow(option));
                    nodes.push(group);
                } else {
                    nodes.push(optionRow(option));
                }
            }
        }
        list.replaceChildren(...nodes);
    };

    // ===== 章节菜单：点击跳转，scrollspy 只在用户手动滚动时接管 =====
    let spyEnabled = true;
    const setMenuActive = (name: string) => {
        for (const button of sections.querySelectorAll("button"))
            button.classList.toggle("active", button.dataset["section"] === name);
    };

    const renderMenu = () => {
        sections.replaceChildren();
        for (const name of sectionNames) {
            const button = el("button") as HTMLButtonElement;
            button.type = "button";
            button.dataset["section"] = name;
            button.append(el("span", "", name));
            button.append(el("span", "count", String(menuSections.get(name)?.length ?? 0)));
            button.addEventListener("click", () => {
                if (state.query !== "") {
                    state.query = "";
                    search.value = "";
                    renderList();
                }
                // 末尾短章节永远滚不到顶，纯 scrollspy 会亮错，所以点击期间高亮跟随点击
                spyEnabled = false;
                setMenuActive(name);
                document.getElementById(sectionId(name))?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
            sections.append(button);
        }
    };

    const renderMenuActive = () => {
        if (!spyEnabled || state.query !== "") return;
        const titles = [...list.querySelectorAll<HTMLElement>(".section-title")];
        let active = "";
        if (titles.length > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
            active = titles[titles.length - 1]?.dataset["section"] ?? "";
        } else {
            const top = scroller.getBoundingClientRect().top;
            for (const title of titles) {
                if (title.getBoundingClientRect().top <= top + 60) active = title.dataset["section"] ?? "";
            }
            if (active === "" && titles.length > 0) active = titles[0]?.dataset["section"] ?? "";
        }
        setMenuActive(active);
    };

    scroller.addEventListener("scroll", () => requestAnimationFrame(renderMenuActive), { passive: true });
    for (const event of ["wheel", "touchmove", "keydown"])
        scroller.addEventListener(event, () => {
            spyEnabled = true;
        }, { passive: true });

    search.addEventListener("input", () => {
        state.query = search.value.trim();
        setMenuActive("");
        renderList();
    });

    renderMenu();
    renderList();
    renderConf();
    refreshStatus();
    renderMenuActive();

    const langButton = must<HTMLButtonElement>("#lang");
    const showLang = () => {
        langButton.textContent = LANG_LABELS[state.lang];
        langButton.title = "切换说明语言：中文 / 日本語 / 英文";
    };
    langButton.addEventListener("click", () => {
        const next = LANGS[(LANGS.indexOf(state.lang) + 1) % LANGS.length];
        if (next !== undefined) state.lang = next;
        showLang();
        renderList();
    });
    showLang();

    // ===== 预览面板的复制 / 下载 =====
    copyButton.addEventListener("click", () => {
        navigator.clipboard.writeText(buildMpvConf(data.options, state.values, header)).then(
            () => {
                status.textContent = "已复制";
                setTimeout(refreshStatus, 1500);
            },
            () => {
                status.textContent = "复制失败";
                setTimeout(refreshStatus, 1500);
            },
        );
    });
    downloadButton.addEventListener("click", () => {
        const blob = new Blob([buildMpvConf(data.options, state.values, header)], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const anchor = el("a") as HTMLAnchorElement;
        anchor.href = url;
        anchor.download = "mpv.conf";
        anchor.click();
        URL.revokeObjectURL(url);
    });

    // ===== 导入 =====
    const dialog = must<HTMLDialogElement>("#dialog");
    const dialogText = must<HTMLTextAreaElement>("#dialog-text");
    const dialogNote = must<HTMLElement>("#dialog-note");
    const importButton = must<HTMLButtonElement>("#dialog-import");

    must("#import").addEventListener("click", () => {
        dialogText.value = "";
        dialogText.readOnly = false;
        dialogNote.textContent = "粘贴现有 mpv.conf 内容，未知选项会列出来但不会丢弃。";
        importButton.hidden = false;
        dialog.showModal();
    });
    must("#reset").addEventListener("click", () => {
        state.values = {};
        store(state);
        renderConf();
        refreshStatus();
        renderList();
    });
    importButton.addEventListener("click", () => {
        const parsed = parseMpvConf(dialogText.value, data.options);
        state.values = { ...state.values, ...parsed.values };
        store(state);
        renderConf();
        refreshStatus();
        renderList();
        dialogNote.textContent =
            parsed.unknown.length === 0
                ? `导入完成，未发现未知选项。`
                : `导入完成。以下 ${parsed.unknown.length} 项本面板不认识（可能是别名、平台专属或新版选项），已保留在文件里但不在此处显示：${parsed.unknown.join("、")}`;
        dialogText.value = "";
        dialogText.readOnly = true;
        importButton.hidden = true;
    });
}

void boot();

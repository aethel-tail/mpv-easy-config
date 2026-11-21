import { buildMpvConf, countModified, isModified, parseMpvConf } from "./mpvconf.js";
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

interface State {
    values: Record<string, Value>;
    section: string;
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

function control(option: Option, state: State, changed: () => void): HTMLElement {
    const widget = option.widget;
    const value = state.values[option.name] ?? widget.def;
    const write = (next: Value) => {
        setValue(state, option.name, next, widget.def);
        changed();
    };

    switch (widget.kind) {
        case "flag": {
            const box = el("input") as HTMLInputElement;
            box.type = "checkbox";
            box.checked = value === true;
            box.addEventListener("change", () => write(box.checked));
            return box;
        }
        case "choice": {
            // A datalist gives the documented values as suggestions while still
            // allowing anything, since the list comes from one specific build.
            const box = el("input") as HTMLInputElement;
            const list = el("datalist");
            const listId = `values-${option.name}`;
            list.id = listId;
            for (const choice of widget.choices) {
                const option_ = el("option") as HTMLOptionElement;
                option_.value = choice;
                list.append(option_);
            }
            box.type = "text";
            box.value = String(value);
            box.setAttribute("list", listId);
            box.addEventListener("input", () => write(box.value));
            const wrapper = el("div", "control-with-list");
            wrapper.append(box, list);
            return wrapper;
        }
        case "number": {
            const box = el("input") as HTMLInputElement;
            box.type = "number";
            box.step = "any";
            if (widget.min !== null) box.min = String(widget.min);
            if (widget.max !== null) box.max = String(widget.max);
            box.value = String(value);
            box.addEventListener("input", () => write(box.value));
            return box;
        }
        case "list":
        case "text": {
            const box = el("input") as HTMLInputElement;
            box.type = "text";
            box.value = String(value);
            if (widget.kind === "list") box.placeholder = "逗号分隔";
            if (option.file) box.placeholder = "文件路径";
            box.addEventListener("input", () => write(box.value));
            return box;
        }
        default: {
            const unhandled: never = widget;
            throw new Error(`unhandled widget ${JSON.stringify(unhandled)}`);
        }
    }
}

function manualLink(option: Option): HTMLElement {
    const link = el("a", "doc-link", "手册") as HTMLAnchorElement;
    link.href = `https://mpv.io/manual/master/#${option.sectionAnchor}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = `${option.section}（手册无单选项锚点，搜索 ${option.name}）`;
    return link;
}

function optionRow(option: Option, state: State, changed: () => void): HTMLElement {
    const row = el("div", "row");
    if (isModified(option, state.values)) row.classList.add("modified");

    const head = el("div", "row-head");
    const name = el("code", "opt-name", option.name);
    if (option.deprecated) name.classList.add("deprecated");
    head.append(name);
    if (isModified(option, state.values)) head.append(el("span", "badge", "已修改"));
    head.append(el("span", "spacer"));
    head.append(manualLink(option));

    const body = el("div", "row-body");
    const defaultLabel = option.widget.kind === "flag" ? (option.widget.def ? "是" : "否") : option.widget.def || "空";
    body.append(el("span", "default", `默认 ${defaultLabel}`));
    body.append(control(option, state, changed));

    const text = el("div", "desc");
    text.append(description(describe(option, state.lang)));

    row.append(head, body, text);
    return row;
}

export async function boot(): Promise<void> {
    const list = must<HTMLElement>("#options");
    const sections = must<HTMLElement>("#sections");
    const search = must<HTMLInputElement>("#search");
    const status = must<HTMLElement>("#status");
    const version = must<HTMLElement>("#version");

    const res = await fetch("./data/options.json", { cache: "no-cache" });
    if (!res.ok) {
        list.textContent = "数据尚未生成（options.json 缺失）";
        return;
    }
    const data = (await res.json()) as OptionsData;
    translations.zh = await loadTranslations("zh");
    translations.ja = await loadTranslations("ja");
    const state: State = { values: load(), section: "", query: "", lang: "zh" };

    const bySection = new Map<string, Option[]>();
    for (const option of data.options) {
        const bucket = bySection.get(option.section);
        if (bucket === undefined) bySection.set(option.section, [option]);
        else bucket.push(option);
    }
    const sectionNames = [...bySection.keys()];
    state.section = sectionNames[0] ?? "";

    version.textContent = `mpv master@${data.mpvCommit.slice(0, 7)} · ${data.options.length} 项`;
    version.title = `${data.mpvVersion}，生成于 ${data.generatedAt}`;

    const refreshStatus = () => {
        const changed = countModified(data.options, state.values);
        status.textContent = changed === 0 ? "未修改任何选项" : `已修改 ${changed} 项`;
    };

    const renderSidebar = () => {
        sections.replaceChildren();
        for (const name of sectionNames) {
            const button = el("button", "section", name) as HTMLButtonElement;
            button.type = "button";
            if (name === state.section && state.query === "") button.classList.add("active");
            button.append(el("span", "count", String(bySection.get(name)?.length ?? 0)));
            button.addEventListener("click", () => {
                state.section = name;
                state.query = "";
                search.value = "";
                render();
            });
            sections.append(button);
        }
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

    const render = () => {
        const changed = () => {
            refreshStatus();
            render();
        };
        const rows: HTMLElement[] = [];
        if (state.query !== "") {
            const hits = data.options.filter(matches).slice(0, MAX_SEARCH_HITS);
            list.replaceChildren();
            const heading = el("h2", "list-title", `搜索 “${state.query}” · ${hits.length} 个结果`);
            list.append(heading);
            for (const option of hits) {
                const group = el("div", "hit");
                group.append(el("span", "hit-section", option.section));
                group.append(optionRow(option, state, changed));
                rows.push(group);
            }
            list.append(...rows);
        } else {
            const options_ = bySection.get(state.section) ?? [];
            list.replaceChildren(el("h2", "list-title", state.section), ...options_.map((option) => optionRow(option, state, changed)));
        }
        renderSidebar();
    };

    search.addEventListener("input", () => {
        state.query = search.value.trim();
        render();
    });
    refreshStatus();
    render();

    const langButton = must<HTMLButtonElement>("#lang");
    const showLang = () => {
        langButton.textContent = LANG_LABELS[state.lang];
        langButton.title = "切换说明语言：中文 / 日本語 / 英文";
    };
    langButton.addEventListener("click", () => {
        const next = LANGS[(LANGS.indexOf(state.lang) + 1) % LANGS.length];
        if (next !== undefined) state.lang = next;
        showLang();
        render();
    });
    showLang();

    // Export / import share one dialog: pasting a config is the fast path for both.
    const dialog = must<HTMLDialogElement>("#dialog");
    const dialogTitle = must<HTMLElement>("#dialog-title");
    const dialogText = must<HTMLTextAreaElement>("#dialog-text");
    const dialogNote = must<HTMLElement>("#dialog-note");
    const copyButton = must<HTMLButtonElement>("#dialog-copy");
    const downloadButton = must<HTMLButtonElement>("#dialog-download");
    const importButton = must<HTMLButtonElement>("#dialog-import");

    const openExport = () => {
        const header = `mpv-easy-config · mpv master@${data.mpvCommit.slice(0, 7)}`;
        const conf = buildMpvConf(data.options, state.values, header);
        dialogTitle.textContent = "导出 mpv.conf";
        dialogText.value = conf === "" ? "" : conf;
        dialogText.readOnly = true;
        dialogNote.textContent = conf === "" ? "还没有改动任何选项，导出为空。" : `${conf.trim().split("\n").length - 1} 行有效配置。`;
        copyButton.hidden = conf === "";
        downloadButton.hidden = conf === "";
        importButton.hidden = true;
        dialog.showModal();
    };

    const openImport = () => {
        dialogTitle.textContent = "导入 mpv.conf";
        dialogText.value = "";
        dialogText.readOnly = false;
        dialogNote.textContent = "粘贴现有 mpv.conf 内容，未知选项会列出来但不会丢弃。";
        copyButton.hidden = true;
        downloadButton.hidden = true;
        importButton.hidden = false;
        dialog.showModal();
    };

    must("#export").addEventListener("click", openExport);
    must("#import").addEventListener("click", openImport);
    must("#reset").addEventListener("click", () => {
        state.values = {};
        store(state);
        refreshStatus();
        render();
    });

    copyButton.addEventListener("click", () => {
        void navigator.clipboard.writeText(dialogText.value);
        dialogNote.textContent = "已复制到剪贴板。";
    });
    downloadButton.addEventListener("click", () => {
        const blob = new Blob([dialogText.value], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const anchor = el("a") as HTMLAnchorElement;
        anchor.href = url;
        anchor.download = "mpv.conf";
        anchor.click();
        URL.revokeObjectURL(url);
    });
    importButton.addEventListener("click", () => {
        const parsed = parseMpvConf(dialogText.value, data.options);
        state.values = { ...state.values, ...parsed.values };
        store(state);
        refreshStatus();
        render();
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

// Parser for `DOCS/man/options.rst` (the source of https://mpv.io/manual/master/).
// Scope is deliberate: only the handful of RST constructs that actually occur in
// options.rst are handled. `report.mjs` measures how much RST markup leaks through,
// so a construct that starts being used shows up as a number instead of as broken UI.

/** @typedef {{ name: string, section: string, en: string }} ParsedOption */

const LITERAL = /``(.+?)``/g;
const LINK = /`([^`]+?)\s*<([^>]+)>`__?/g;
const INTERNAL_REF = /`([^`]+?)`_/g;
const ESCAPED = /\\([\\`*_{}[\]()#+\-.!|~^])/g;

/**
 * All inline literals on a line, plus the line with those literals removed.
 * @param {string} line
 * @returns {{ spans: string[], stripped: string }}
 */
function splitLiterals(line) {
    /** @type {string[]} */
    const spans = [];
    let stripped = "";
    let last = 0;
    LITERAL.lastIndex = 0;
    for (let m = LITERAL.exec(line); m !== null; m = LITERAL.exec(line)) {
        spans.push(m[1] ?? "");
        stripped += line.slice(last, m.index);
        last = m.index + m[0].length;
    }
    stripped += line.slice(last);
    return { spans, stripped };
}

/**
 * Option names declared by a definition-list term line, or null if the line is not one.
 * ` ``--a=<x>``, ``--b=<y>`` ` declares two names sharing one description.
 * @param {string} line
 * @returns {string[] | null}
 */
export function headerNames(line) {
    if (!line.startsWith("``")) return null;
    const { spans, stripped } = splitLiterals(line.trimEnd());
    if (spans.length === 0 || !/^[,\s]*$/.test(stripped)) return null;
    /** @type {string[]} */
    const names = [];
    for (const span of spans) {
        const m = /^--([A-Za-z0-9][A-Za-z0-9_-]*)/.exec(span);
        // A literal that is not an option term means this is prose, not a term line.
        if (!m) return null;
        const name = m[1];
        if (name !== undefined) names.push(name);
    }
    return names;
}

/**
 * Title of a section heading, if line i is one.
 * @param {string[]} lines
 * @param {number} i
 * @returns {{ title: string, depth: number } | null}
 */
export function heading(lines, i) {
    const title = (lines[i] ?? "").trimEnd();
    const underline = lines[i + 1] ?? "";
    if (title === "" || title !== (lines[i] ?? "")) return null;
    const m = /^([-=~])\1{3,}$/.exec(underline);
    if (!m) return null;
    const marker = m[1] === "=" ? 1 : m[1] === "-" ? 2 : 3;
    return { title, depth: marker };
}

/**
 * Code span that survives content containing a backtick (`The `` ` `` key`).
 * @param {string} text
 * @returns {string}
 */
function codeSpan(text) {
    return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}

/**
 * Convert an RST inline markup fragment to the Markdown subset the UI renders.
 * @param {string} text
 * @returns {string}
 */
export function inlineToMarkdown(text) {
    return text
        .replace(LINK, (_all, label, url) => `[${label}](${url})`)
        .replace(INTERNAL_REF, "$1")
        .replace(LITERAL, (_all, code) => codeSpan(code))
        .replace(ESCAPED, "$1");
}

/**
 * Replace `.. note::` / `.. admonition:: Title` with a bold label and pull the
 * indented block up by one level, so the rest of the pipeline sees plain Markdown.
 * @param {string[]} lines
 * @returns {string[]}
 */
function expandDirectives(lines) {
    /** @type {string[]} */
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const m = /^( *)\.\. (admonition|note|warning|important)::[ \t]*(.*)$/.exec(line);
        if (!m) {
            out.push(line);
            continue;
        }
        const lead = (m[1] ?? "").length;
        const kind = m[2] ?? "note";
        const title = (m[3] ?? "").trim();
        const label = title !== "" ? title : kind.charAt(0).toUpperCase() + kind.slice(1);
        out.push(`**${label}**`);
        /** @type {string[]} */
        const block = [];
        let j = i + 1;
        for (; j < lines.length; j++) {
            const next = lines[j] ?? "";
            if (next.trim() === "") {
                block.push("");
                continue;
            }
            const nextLead = (/^ */.exec(next) ?? [""])[0].length;
            // The directive body is indented deeper than the directive itself.
            if (nextLead <= lead) break;
            block.push(next.slice(Math.min(nextLead, lead + 4)));
        }
        while (block.length > 0 && block[block.length - 1] === "") block.pop();
        out.push(...block);
        i = j - 1;
    }
    return out;
}

/**
 * Join hard-wrapped paragraph lines into one line per paragraph. Translation quality
 * depends on this: a sentence split across source lines becomes two fragments.
 * @param {string[]} lines
 * @returns {string[]}
 */
function reflow(lines) {
    /** @type {string[]} */
    const out = [];
    let buffer = "";
    const flush = () => {
        if (buffer !== "") out.push(buffer);
        buffer = "";
    };
    for (const raw of lines) {
        const line = raw.trimEnd();
        const trimmed = line.trim();
        if (trimmed === "") {
            flush();
            out.push("");
            continue;
        }
        const indented = line.length !== trimmed.length;
        const blockStart = indented || /^([-*+]|\d+\.)\s/.test(trimmed);
        if (blockStart) {
            flush();
            out.push(trimmed);
            continue;
        }
        buffer = buffer === "" ? trimmed : `${buffer} ${trimmed}`;
    }
    flush();
    return out;
}

/**
 * `... text::` followed by an indented block becomes a fenced code block.
 * @param {string[]} lines
 * @returns {string[]}
 */
function fenceLiteralBlocks(lines) {
    /** @type {string[]} */
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (!line.endsWith("::")) {
            out.push(line);
            continue;
        }
        out.push(`${line.slice(0, -2)}:`.replace(/:+$/, ":"));
        /** @type {string[]} */
        const block = [];
        let j = i + 1;
        for (; j < lines.length && (lines[j] ?? "").trim() !== ""; j++) {
            block.push((lines[j] ?? "").trim());
        }
        if (block.length > 0) {
            out.push("```", ...block, "```");
            i = j - 1;
        }
    }
    return out;
}

/**
 * @param {string[]} lines dedented body lines
 * @returns {string}
 */
export function bodyToMarkdown(lines) {
    const converted = fenceLiteralBlocks(reflow(expandDirectives(lines)));
    const text = converted.map((line) => inlineToMarkdown(line)).join("\n");
    return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Section anchors on mpv.io follow docutils' id convention: lowercase, drop
 * punctuation, spaces to dashes.
 * @param {string} title
 * @returns {string}
 */
export function sectionAnchor(title) {
    return title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-");
}

/**
 * @param {string} source full text of options.rst
 * @returns {ParsedOption[]}
 */
export function parseOptionsRst(source) {
    const lines = source.split(/\r?\n/);
    /** @type {ParsedOption[]} */
    const options = [];
    let section = "";

    for (let i = 0; i < lines.length; i++) {
        const head = heading(lines, i);
        if (head !== null) {
            if (head.depth === 2) section = head.title;
            continue;
        }
        const names = headerNames(lines[i] ?? "");
        if (names === null) continue;

        // Body runs until the next term line or heading; every body line is indented.
        let end = i + 1;
        while (end < lines.length) {
            const candidate = lines[end] ?? "";
            if (candidate.trim() !== "" && !/^ {2,}/.test(candidate)) break;
            if (heading(lines, end) !== null) break;
            end++;
        }
        const body = lines.slice(i + 1, end);
        const indent = Math.min(
            ...body.filter((l) => l.trim() !== "").map((l) => (/^ */.exec(l) ?? [""])[0].length),
        );
        const dedented = body.map((l) => (l.trim() === "" ? "" : l.slice(Number.isFinite(indent) ? indent : 0)));
        const en = bodyToMarkdown(dedented);
        for (const name of names) {
            // A term ending in "-" documents a family of options (``--cdda-...=...``), not one.
            if (name.endsWith("-")) continue;
            options.push({ name, section, en });
        }
        i = end - 1;
    }
    return options;
}

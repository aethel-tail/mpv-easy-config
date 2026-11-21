// Parses `mpv --list-options` output. This is the only reliable source of option
// types, defaults, ranges and choice lists: the RST manual states defaults for
// only ~9% of options and never lists choices.
//
// Output format is emitted by m_config_print_option_list() in mpv's
// options/m_config_frontend.c: " --name<pad to 30><type or Choices:..>[ (min to max)]
// [ (default: x)][ [file]][ [not in config files]][ [deprecated]][ for alias]".
// Unrecognised lines degrade to a text widget rather than being dropped.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** @typedef {import("../src/types.js").Widget} Widget */
/** @typedef {{ name: string, widget: Widget, file: boolean, deprecated: boolean }} OptionMeta */

/** Type names as emitted by mpv; anything else falls back to text. */
const FLAG = "Flag";
const NUMERIC = new Set(["Integer", "Integer64", "Float", "Double"]);
const LIST = new Set([
    "String list",
    "Key/value list",
    "Object settings list",
    "Audio channels or channel map",
    "Property array",
    "Output verbosity levels",
]);

/**
 * @param {string} text
 * @param {number | null} min
 * @param {number | null} max
 * @returns {Widget}
 */
function numericWidget(text, min, max) {
    return { kind: "number", min, max, def: text };
}

/**
 * @param {string} segment e.g. "Float (-100 to 100)"
 * @returns {{ type: string, min: number | null, max: number | null }}
 */
function splitRange(segment) {
    const m = /^(.*?)\s*\((-?[\d.e+-]+|any) to (-?[\d.e+-]+|any)\)$/.exec(segment);
    if (m === null) return { type: segment.trim(), min: null, max: null };
    const toNumber = (/** @type {string} */ s) => (s === "any" ? null : Number(s));
    return { type: (m[1] ?? "").trim(), min: toNumber(m[2] ?? "any"), max: toNumber(m[3] ?? "any") };
}

/**
 * @param {string} rest attribute string with default/range/flags removed
 * @param {string} def
 * @returns {Widget}
 */
function toWidget(rest, def) {
    if (rest.startsWith("Choices:")) {
        const choices = rest
            .slice("Choices:".length)
            .trim()
            .split(/\s+/)
            .filter((c) => c !== "" && c !== "(or" && c !== "an" && c !== "integer)");
        return { kind: "choice", choices, def };
    }
    if (rest === FLAG) return { kind: "flag", def: def === "yes" };
    if (LIST.has(rest)) return { kind: "list", def };
    if (NUMERIC.has(rest)) return numericWidget(def, null, null);
    return { kind: "text", def };
}

/**
 * @param {string} line
 * @returns {OptionMeta | null} null for lines that are not top-level options
 */
export function parseOptionLine(line) {
    // Action variants ("--vo=gpu-add" and friends) are indented under their parent.
    if (!line.startsWith(" --")) return null;
    const head = /^ --(\S+)\s(.*)$/.exec(line);
    if (head === null) return null;
    const name = head[1] ?? "";
    let rest = (head[2] ?? "").trim();

    // Aliases and CLI-only aliases duplicate a name that is documented elsewhere.
    if (/(?:^|\s)for\s/.test(rest)) return null;

    let file = false;
    let deprecated = false;
    const flagPattern = /\[(not in config files|file|deprecated)\]$/;
    for (let m = flagPattern.exec(rest); m !== null; m = flagPattern.exec(rest)) {
        const flag = m[1] ?? "";
        if (flag === "file") file = true;
        if (flag === "not in config files") return null; // unsettable from mpv.conf
        if (flag === "deprecated") deprecated = true;
        rest = rest.slice(0, m.index).trim();
    }

    let def = "";
    const defaultAt = rest.lastIndexOf("(default: ");
    if (defaultAt !== -1 && rest.endsWith(")")) {
        def = rest.slice(defaultAt + "(default: ".length, -1);
        rest = rest.slice(0, defaultAt).trim();
    }

    const { type, min, max } = splitRange(rest);
    let widget;
    if (min !== null || max !== null) {
        widget = NUMERIC.has(type) ? numericWidget(def, min, max) : toWidget(type, def);
    } else {
        widget = toWidget(type, def);
    }
    if (type === "removed") deprecated = true;
    return { name, widget, file, deprecated };
}

/** Lines describing an option that cannot be set from mpv.conf (alias or CLI-only). */
const UNSETTABLE = /\[not in config files\]|(?:^|\s)for\s/;

/**
 * @param {string} text full output of `mpv --list-options`
 * @returns {{ metas: OptionMeta[], unsettable: string[] }}
 */
export function parseListOptions(text) {
    /** @type {OptionMeta[]} */
    const metas = [];
    /** @type {string[]} */
    const unsettable = [];
    const seen = new Set();
    for (const line of text.split(/\r?\n/)) {
        const meta = parseOptionLine(line);
        if (meta === null) {
            const name = /^ --(\S+)\s/.exec(line)?.[1];
            if (name !== undefined && UNSETTABLE.test(line)) unsettable.push(name);
            continue;
        }
        if (seen.has(meta.name)) continue;
        seen.add(meta.name);
        metas.push(meta);
    }
    return { metas, unsettable };
}

/** CI points this at an extracted mpv AppImage; the release is much newer than apt's. */
const MPV_BIN = process.env.MPV_BIN ?? "mpv";

/** First line of `mpv --version` is "mpv 0.41.0". */
function readVersion() {
    const out = execFileSync(MPV_BIN, ["--version"], { encoding: "utf8" });
    return out.split("\n")[0]?.trim() ?? "";
}

/** @returns {Promise<{ dir: string, count: number }>} */
export async function captureListOptions() {
    const meta = JSON.parse(readFileSync(join(".cache", "meta.json"), "utf8"));
    const sha = String(meta.mpvCommit ?? "");
    if (sha === "") throw new Error("run scripts/fetch-manual.mjs first");
    const text = execFileSync(MPV_BIN, ["--list-options"], { encoding: "utf8" });
    const { metas, unsettable } = parseListOptions(text);
    const dir = join(".cache", sha);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, "list-options.json"),
        `${JSON.stringify({ mpvVersion: readVersion(), metas, unsettable }, null, 2)}\n`,
    );
    return { dir, count: metas.length };
}

if (import.meta.main) {
    const result = await captureListOptions();
    console.log(`captured ${result.count} options -> ${result.dir}/list-options.json`);
}

import type { Option } from "./types.js";

/** A flag is a boolean; every other widget keeps mpv's own textual form. */
export type Value = string | boolean;

export interface ParsedConf {
    values: Record<string, Value>;
    /** Keys in the file that this build does not know; reported, never dropped silently. */
    unknown: string[];
}

/** The widget's default, in the same representation the UI stores. */
export function defaultValue(option: Option): Value {
    return option.widget.def;
}

export function isModified(option: Option, values: Record<string, Value>): boolean {
    const value = values[option.name];
    return value !== undefined && value !== option.widget.def;
}

/**
 * mpv accepts both `osc=no` and `no-osc`; the `no-` form is what people write by hand.
 * Values that equal the default are omitted, and so is an emptied text field: writing
 * `scale=` would make mpv complain, while omitting it simply keeps the default.
 */
export function buildMpvConf(options: Option[], values: Record<string, Value>, header = ""): string {
    const lines: string[] = [];
    for (const option of [...options].sort((a, b) => a.name.localeCompare(b.name))) {
        const value = values[option.name];
        if (value === undefined || value === option.widget.def) continue;
        if (typeof value === "boolean") {
            if (option.widget.kind !== "flag") continue;
            lines.push(value ? option.name : `no-${option.name}`);
            continue;
        }
        const trimmed = value.trim();
        if (trimmed === "") continue;
        lines.push(`${option.name}=${trimmed}`);
    }
    // An empty config is what tells the caller "nothing to export"; a lone comment
    // would look like a successful export to mpv and to the user.
    if (lines.length === 0) return "";
    const body = header === "" ? lines : [`# ${header}`, ...lines];
    return `${body.join("\n")}\n`;
}

/**
 * Quotes are stripped only when they wrap the whole value, which is the common
 * `key="path with spaces"` form and keeps a value that merely contains a quote intact.
 */
function unquote(value: string): string {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"') && !value.slice(1, -1).includes('"')) {
        return value.slice(1, -1);
    }
    return value;
}

export function parseMpvConf(text: string, options: Option[]): ParsedConf {
    const byName = new Map(options.map((option) => [option.name, option]));
    const values: Record<string, Value> = {};
    const unknown: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        let key = (eq === -1 ? line : line.slice(0, eq)).trim();
        const rawValue = eq === -1 ? "" : line.slice(eq + 1).trim();
        if (key.startsWith("--")) key = key.slice(2);
        const base = key.startsWith("no-") ? key.slice(3) : key;
        const option = byName.get(base) ?? byName.get(key);
        if (option === undefined) {
            unknown.push(key);
            continue;
        }
        if (option.widget.kind === "flag") {
            // `osc` alone means true, `no-osc` means false, and `osc=no` also means false.
            const inline = eq === -1 ? undefined : rawValue !== "no" && rawValue !== "false";
            values[option.name] = inline ?? !(key !== base);
            continue;
        }
        values[option.name] = unquote(rawValue);
    }
    return { values, unknown };
}

/** Number of options whose stored value differs from the widget default. */
export function countModified(options: Option[], values: Record<string, Value>): number {
    return options.filter((option) => isModified(option, values)).length;
}

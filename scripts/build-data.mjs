// Merges the RST descriptions with the `mpv --list-options` metadata into the single
// file the page loads. Options missing metadata degrade to a text widget and are
// listed in `degraded`; options with metadata but no documented description are
// dropped and counted, since a name with no explanation is not configurable in a UI.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseOptionsRst, sectionAnchor } from "./rst.mjs";

const CACHE = ".cache";
const OUT = "site/data/options.json";

/** @param {string} text */
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);

/**
 * @param {import("./rst.mjs").ParsedOption[]} parsed
 * @param {import("./list-options.mjs").OptionMeta[]} metas
 * @param {{ mpvCommit: string, mpvVersion: string }} versions
 * @param {string[]} unsettable names mpv itself refuses to read from a config file
 * @returns {import("../src/types.js").OptionsData}
 */
export function mergeOptions(parsed, metas, versions, unsettable = []) {
    const byName = new Map(metas.map((meta) => [meta.name, meta]));
    const notSettable = new Set(unsettable);
    /** @type {import("../src/types.js").Option[]} */
    const options = [];
    /** @type {string[]} */
    const degraded = [];
    const seen = new Set();
    for (const option of parsed) {
        // a handful of terms are documented twice; CLI-only options cannot go in mpv.conf
        if (seen.has(option.name) || notSettable.has(option.name)) continue;
        seen.add(option.name);
        const meta = byName.get(option.name);
        if (meta === undefined) degraded.push(option.name);
        options.push({
            name: option.name,
            section: option.section,
            sectionAnchor: sectionAnchor(option.section),
            en: option.en,
            textHash: hash(option.en),
            file: meta?.file ?? false,
            deprecated: meta?.deprecated ?? false,
            widget: meta?.widget ?? { kind: "text", def: "" },
        });
    }
    return {
        generatedAt: new Date().toISOString(),
        mpvCommit: versions.mpvCommit,
        mpvVersion: versions.mpvVersion,
        degraded,
        undocumented: metas.filter((meta) => !seen.has(meta.name)).map((meta) => meta.name),
        options,
    };
}

/** Newest fetched revision directory under .cache. */
function locate() {
    const dirs = readdirSync(CACHE, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[0-9a-f]{40}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    const newest = dirs.at(-1);
    if (newest === undefined) throw new Error(`nothing in ${CACHE}/; run fetch-manual.mjs first`);
    return join(CACHE, newest);
}

if (import.meta.main) {
    const dir = locate();
    const parsed = parseOptionsRst(readFileSync(join(dir, "options.rst"), "utf8"));
    const captured = JSON.parse(readFileSync(join(dir, "list-options.json"), "utf8"));
    const data = mergeOptions(parsed, captured.metas, {
        mpvCommit: dir.slice(CACHE.length + 1),
        mpvVersion: String(captured.mpvVersion ?? ""),
    }, captured.unsettable ?? []);
    const out = process.argv.includes("--out")
        ? (process.argv[process.argv.indexOf("--out") + 1] ?? OUT)
        : OUT;
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, `${JSON.stringify(data)}\n`);
    console.log(
        `${data.options.length} options (${data.degraded.length} degraded, ${data.undocumented.length} undocumented) -> ${out}`,
    );
}

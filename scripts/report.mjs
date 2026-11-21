// Measures the RST parse against the acceptance thresholds in STEPS.md §M1.
// Run it after fetch-manual.mjs; it exits non-zero when a threshold is missed so CI
// fails loudly instead of publishing a half-parsed manual.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseOptionsRst, sectionAnchor } from "./rst.mjs";

const CACHE = ".cache";
const DATA = "site/data/options.json";
const THRESHOLDS = { options: 700, sections: 15, emptyDescriptions: 0, leakageRatio: 0.02, metadataCoverage: 0.9, translationCoverage: 0.95 };

/** Newest fetched manual under .cache/<sha>/options.rst, or null when there is none.
 *  The publish job only has the committed data, so the RST checks become optional. */
function locate() {
    if (!existsSync(CACHE)) return null;
    const dirs = readdirSync(CACHE, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^[0-9a-f]{40}$/.test(d.name))
        .map((d) => d.name)
        .sort();
    const newest = dirs.at(-1);
    return newest === undefined ? null : join(CACHE, newest, "options.rst");
}

const sourcePath = locate();
if (sourcePath === null) console.log(`(no ${CACHE}/; skipping the RST checks)`);
const source = sourcePath === null ? "" : readFileSync(sourcePath, "utf8");
const parsed = parseOptionsRst(source);

const seen = new Map();
const duplicates = [];
for (const option of parsed) {
    if (seen.has(option.name)) duplicates.push(option.name);
    else seen.set(option.name, option);
}
const options = [...seen.values()];
const sections = [...new Set(options.map((o) => o.section))];
const empty = options.filter((o) => o.en === "");
// Leftover RST: a directive, a stray double-backtick literal, or an unresolved
// internal reference (`foo`_). Backticks inside paths like `_NET_WM_X` are not leaks,
// and ` `` ` ``  is a valid Markdown code span containing a backtick.
const RST_LEAK = /\.\. [a-z]+::|``|[a-z0-9]`_/;
/** @param {string} text @returns {string} */
const stripValid = (text) => text.replace(/`` [^`\n]+ ``/g, "").replace(/`` ` ``/g, "");
const leaky = options.filter((o) => RST_LEAK.test(stripValid(o.en)));

const report = {
    sourcePath,
    parsedTerms: parsed.length,
    options: options.length,
    duplicateNames: duplicates,
    sections: sections.length,
    emptyDescriptions: empty.map((o) => o.name),
    leakage: { count: leaky.length, ratio: leaky.length / Math.max(options.length, 1), sample: leaky.slice(0, 5).map((o) => o.name) },
    avgChars: Math.round(options.reduce((n, o) => n + o.en.length, 0) / Math.max(options.length, 1)),
};
console.log(JSON.stringify(report, null, 2));

const failures = [];
if (sourcePath !== null) {
if (options.length < THRESHOLDS.options) failures.push(`options ${options.length} < ${THRESHOLDS.options}`);
if (sections.length < THRESHOLDS.sections) failures.push(`sections ${sections.length} < ${THRESHOLDS.sections}`);
if (empty.length > THRESHOLDS.emptyDescriptions) failures.push(`empty descriptions ${empty.length} > ${THRESHOLDS.emptyDescriptions}`);
if (report.leakage.ratio > THRESHOLDS.leakageRatio) failures.push(`rst leakage ${(report.leakage.ratio * 100).toFixed(1)}% > ${THRESHOLDS.leakageRatio * 100}%`);
}

// Section anchors must exist as ids on the live manual page, otherwise deep links
// land nowhere. Checked only when asked, since it needs the network.
if (sourcePath !== null && process.argv.includes("--anchors")) {
    const html = await (await fetch("https://mpv.io/manual/master/")).text();
    const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));
    const missing = sections.map(sectionAnchor).filter((id) => !ids.has(id));
    console.log(`\nanchors: ${sections.length - missing.length}/${sections.length} section ids found on the live page`);
    if (missing.length > 0) {
        console.log(`missing: ${missing.join(", ")}`);
        failures.push(`${missing.length} section anchor(s) missing from the manual page`);
    }
}

if (failures.length > 0) {
    console.error(`\nFAIL\n- ${failures.join("\n- ")}`);
    process.exit(1);
}
console.log("\nOK");

// Metadata half: only meaningful once build-data has run against a real mpv.
if (existsSync(DATA)) {
    const data = /** @type {import("../src/types.js").OptionsData} */ (JSON.parse(readFileSync(DATA, "utf8")));
    const all = data.options;
    /** @type {Record<string, number>} */
    const kinds = {};
    for (const option of all) kinds[option.widget.kind] = (kinds[option.widget.kind] ?? 0) + 1;
    const nonText = all.length - (kinds.text ?? 0);
    const coverage = (all.length - data.degraded.length) / Math.max(all.length, 1);
    const dataReport = {
        built: all.length,
        mpvVersion: data.mpvVersion,
        widgetKinds: kinds,
        metadataCoverage: coverage,
        degraded: data.degraded.length,
        undocumented: data.undocumented.length,
    };
    console.log(JSON.stringify(dataReport, null, 2));
    console.log(`(non-text widgets: ${((nonText / Math.max(all.length, 1)) * 100).toFixed(1)}% — informational)`);
    const bad = [];
    if (coverage < THRESHOLDS.metadataCoverage) {
        bad.push(`metadata coverage ${(coverage * 100).toFixed(1)}% < ${THRESHOLDS.metadataCoverage * 100}%`);
    }

    // Translation coverage is reported always, but only gated when asked: a local
    // run is expected to be partial, while CI passes --require-translations.
    const hashes = new Set(all.map((option) => option.textHash));
    for (const lang of ["zh", "ja"]) {
        const path = `site/data/trans.${lang}.json`;
        if (!existsSync(path)) continue;
        const cache = JSON.parse(readFileSync(path, "utf8"));
        const done = [...hashes].filter((hash) => cache[hash] !== undefined).length;
        const ratio = done / Math.max(hashes.size, 1);
        console.log(`trans.${lang}.json: ${done}/${hashes.size} hashes (${(ratio * 100).toFixed(1)}%)`);
        if (process.argv.includes("--require-translations") && ratio < THRESHOLDS.translationCoverage) {
            bad.push(`${lang} translation coverage ${(ratio * 100).toFixed(1)}% < ${THRESHOLDS.translationCoverage * 100}%`);
        }
    }
    if (bad.length > 0) {
        console.error(`\nFAIL\n- ${bad.join("\n- ")}`);
        process.exit(1);
    }
}

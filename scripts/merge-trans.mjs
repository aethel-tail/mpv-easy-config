// Merges the per-shard translation artifacts back into site/data/trans.<lang>.json.
// Existing entries win over artifact entries so a hand-fixed translation survives.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const partsDir = process.argv[2] ?? "parts";
const outDir = process.argv[3] ?? "site/data";
mkdirSync(outDir, { recursive: true });

for (const lang of ["zh", "ja"]) {
    const outPath = join(outDir, `trans.${lang}.json`);
    /** @type {Record<string, string>} */
    const merged = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
    let added = 0;
    for (const part of existsSync(partsDir) ? readdirSync(partsDir) : []) {
        const file = join(partsDir, part, `trans.${lang}.json`);
        if (!existsSync(file)) continue;
        /** @type {Record<string, string>} */
        const chunk = JSON.parse(readFileSync(file, "utf8"));
        for (const [hash, text] of Object.entries(chunk)) {
            if (merged[hash] === undefined) added += 1;
            merged[hash] = text;
        }
    }
    writeFileSync(outPath, `${JSON.stringify(merged)}\n`);
    console.log(`trans.${lang}.json: ${Object.keys(merged).length} entries (+${added})`);
}

// Per-shard translation reports are merged too: CI logs need repository admin
// rights, so the pipeline publishes its own diagnostics next to the data.
/** @type {{ lang: string, shard: number, pending: number, translated: number, rejected: number, samples: { name: string, reason: string }[] }[]} */
const reports = [];
for (const part of existsSync(partsDir) ? readdirSync(partsDir) : []) {
    for (const lang of ["zh", "ja"]) {
        const file = join(partsDir, part, `trans.${lang}.report.json`);
        if (!existsSync(file)) continue;
        reports.push(JSON.parse(readFileSync(file, "utf8")));
    }
}
writeFileSync(join(outDir, "translate-report.json"), `${JSON.stringify(reports, null, 2)}
`);
console.log(`translate-report.json: ${reports.length} shard reports, ${reports.reduce((n, r) => n + r.translated, 0)} translated, ${reports.reduce((n, r) => n + r.rejected, 0)} rejected`);

// Merges the per-shard translation artifacts back into site/data/trans.<lang>.json.
// Existing entries win over artifact entries so a hand-fixed translation survives.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const partsDir = process.argv[2] ?? "parts";
const outDir = process.argv[3] ?? "site/data";

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

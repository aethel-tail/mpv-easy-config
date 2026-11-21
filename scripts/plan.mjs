// Decides whether anything needs doing, without touching the GitHub API:
// unauthenticated API requests are rate limited per IP and GitHub-hosted runners
// share IPs, so the commit lookup failed on the first CI run. `git ls-remote`
// has no such limit and gives the same information.
//
// Inputs:  .cache/new/options.json (freshly built) and site/data/options.json (committed)
// Outputs: GitHub Actions outputs changed / pending / shards / shardList, and a
//          replaced site/data/options.json when the content actually differs.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const NEW = ".cache/new/options.json";
const DATA = "site/data/options.json";

/**
 * Everything except the timestamp: rebuilding identical input must look unchanged,
 * otherwise every scheduled run commits a one-line diff forever.
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function fingerprint(data) {
    const copy = { ...data };
    delete copy.generatedAt;
    return JSON.stringify(copy);
}

/**
 * One translation pair per distinct description hash: a hash counts as pending until
 * every language has it.
 * @param {{ textHash: string }[]} options
 * @param {Record<string, string>[]} caches
 * @returns {number}
 */
export function pendingCount(options, caches) {
    const hashes = new Set(options.map((option) => option.textHash));
    let pending = 0;
    for (const hash of hashes) {
        if (caches.some((cache) => cache[hash] === undefined)) pending += 1;
    }
    return pending;
}

/** @param {string} key @param {string | number | boolean} value */
function output(key, value) {
    console.log(`${key}=${value}`);
    if (process.env.GITHUB_OUTPUT !== undefined) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/** @param {string} file */
function loadCache(file) {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

if (import.meta.main) {
    const next = JSON.parse(readFileSync(NEW, "utf8"));
    const previous = existsSync(DATA) ? JSON.parse(readFileSync(DATA, "utf8")) : null;
    const changed = previous === null || fingerprint(previous) !== fingerprint(next);
    if (changed) {
        writeFileSync(DATA, `${JSON.stringify(next)}\n`);
        console.log(`data changed: ${previous?.mpvCommit ?? "none"} -> ${next.mpvCommit}`);
    } else {
        console.log(`data unchanged at ${next.mpvCommit}`);
    }

    const caches = ["zh", "ja"].map((lang) => loadCache(`site/data/trans.${lang}.json`));
    // An unset workflow input arrives as an empty string, not as undefined, so `??`
    // would keep it and number the whole run as a single shard.
    const requested = Number(process.env.SHARDS_INPUT || 0) || Number(process.env.SHARDS_VAR || 0) || 8;
    const shards = Math.max(requested, 1);
    output("changed", changed);
    output("pending", pendingCount(next.options, caches));
    output("shards", shards);
    output("shardList", JSON.stringify([...Array(shards).keys()]));
}

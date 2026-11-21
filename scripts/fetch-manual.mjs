// Fetches the manual source at the commit that last touched DOCS/man, so a run
// always parses exactly one revision and the commit sha can be recorded in meta.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "mpv-player/mpv";
const MAN_DIR = "DOCS/man";
const CACHE = ".cache";

/**
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function get(url) {
    const res = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
    return res;
}

/**
 * Latest commit touching the manual directory.
 * @returns {Promise<string>}
 */
async function latestManualCommit() {
    const res = await get(`https://api.github.com/repos/${REPO}/commits?path=${MAN_DIR}&per_page=1`);
    const body = await res.json();
    const sha = Array.isArray(body) ? body[0]?.sha : undefined;
    if (typeof sha !== "string") throw new Error("unexpected commits response");
    return sha;
}

/**
 * @param {string} sha
 * @returns {Promise<{ sha: string, options: string, dir: string }>}
 */
export async function fetchManual(sha) {
    const rev = sha === "" ? await latestManualCommit() : sha;
    const res = await get(`https://raw.githubusercontent.com/${REPO}/${rev}/DOCS/man/options.rst`);
    const options = await res.text();
    const dir = join(CACHE, rev);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "options.rst"), options);
    writeFileSync(join(CACHE, "meta.json"), `${JSON.stringify({ mpvCommit: rev, fetchedAt: new Date().toISOString() }, null, 2)}\n`);
    return { sha: rev, options, dir };
}

if (import.meta.main) {
    const sha = process.argv[2] ?? "";
    const result = await fetchManual(sha);
    console.log(`fetched mpv@${result.sha.slice(0, 7)} -> ${result.dir}/options.rst (${result.options.length} bytes)`);
}

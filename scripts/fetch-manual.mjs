// Fetches the manual source at one exact revision, so a run always parses a single
// consistent snapshot and can record which revision it used.
//
// The revision comes from `git ls-remote` rather than the REST API: unauthenticated
// API calls are rate limited per IP, and GitHub-hosted runners share IPs, which made
// the very first CI run fail before it parsed anything.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "mpv-player/mpv";
const CACHE = ".cache";

/** Head of the master branch, or "master" if git is unavailable. */
function headRevision() {
    try {
        const out = execFileSync("git", ["ls-remote", `https://github.com/${REPO}.git`, "refs/heads/master"], {
            encoding: "utf8",
            timeout: 60_000,
        });
        const sha = out.split(/\s+/)[0] ?? "";
        return /^[0-9a-f]{40}$/.test(sha) ? sha : "master";
    } catch (error) {
        console.error(`git ls-remote failed, falling back to master: ${/** @type {Error} */ (error).message}`);
        return "master";
    }
}

/**
 * @param {string} sha
 * @returns {Promise<{ sha: string, options: string, dir: string }>}
 */
export async function fetchManual(sha) {
    const rev = sha === "" ? headRevision() : sha;
    const url = `https://raw.githubusercontent.com/${REPO}/${rev}/DOCS/man/options.rst`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
    const options = await res.text();
    const dir = join(CACHE, rev);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "options.rst"), options);
    writeFileSync(join(CACHE, "meta.json"), `${JSON.stringify({ mpvCommit: rev, fetchedAt: new Date().toISOString() }, null, 2)}\n`);
    return { sha: rev, options, dir };
}

if (import.meta.main) {
    const result = await fetchManual(process.argv[2] ?? "");
    console.log(`fetched mpv@${result.sha.slice(0, 7)} -> ${result.dir}/options.rst (${result.options.length} bytes)`);
}

// Bans explicit `any` and its three escape hatches.
// Uses the TypeScript parser instead of a regex: a regex would also flag the word
// "any" inside prose and strings, the inevitable next step would be loosening it,
// and a loosened check is worse than no check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";

/** @type {readonly string[]} */
const ROOTS = ["src", "scripts", "test"];
/** @type {ReadonlySet<string>} */
const EXTS = new Set([".ts", ".mjs"]);
/** @type {readonly string[]} */
const ESCAPES = ["@ts-ignore", "@ts-expect-error", "@ts-nocheck"];

/** @type {{ file: string, line: number, col: number, what: string }[]} */
const findings = [];

/**
 * Yields every source file under dir, skipping node_modules. A missing dir is fine.
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* walk(dir) {
    /** @type {string[]} */
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const name of entries) {
        if (name === "node_modules") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) yield* walk(path);
        else if (EXTS.has(extname(name))) yield path;
    }
}

/**
 * @param {string} file
 * @param {string} text
 * @returns {ts.SourceFile}
 */
function parse(file, text) {
    const kind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    return ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, kind);
}

/**
 * @param {ts.SourceFile} sf
 * @param {string} file
 */
function checkAnyKeywords(sf, file) {
    /** @param {ts.Node} node */
    const visit = (node) => {
        if (node.kind === ts.SyntaxKind.AnyKeyword) {
            const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            findings.push({ file, line: pos.line + 1, col: pos.character + 1, what: "explicit `any`" });
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
}

/**
 * Comments are scanned as tokens, so the same strings inside string literals or
 * prose are not false positives.
 * @param {ts.SourceFile} sf
 * @param {string} file
 * @param {string} text
 */
function checkEscapeHatches(sf, file, text) {
    const scanner = ts.createScanner(ts.ScriptTarget.ES2022, false, ts.LanguageVariant.Standard, text);
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) {
            continue;
        }
        // Strip the comment marker: a directive only counts when it starts the comment,
        // which is also the only position TypeScript itself honours. Prose that merely
        // mentions the directive is therefore not a false positive.
        const comment = scanner.getTokenText().replace(/^\/\*|^\/\//, "").trimStart();
        for (const escape of ESCAPES) {
            if (!comment.startsWith(escape)) continue;
            const pos = sf.getLineAndCharacterOfPosition(scanner.getTokenPos());
            findings.push({ file, line: pos.line + 1, col: pos.character + 1, what: escape });
        }
    }
}

for (const root of ROOTS) {
    for (const file of walk(root)) {
        const text = readFileSync(file, "utf8");
        const sf = parse(file, text);
        checkAnyKeywords(sf, file);
        checkEscapeHatches(sf, file, text);
    }
}

if (findings.length === 0) {
    console.log("no-any: clean");
    process.exit(0);
}

for (const f of findings) console.error(`${f.file}:${f.line}:${f.col}  ${f.what}`);
console.error(`\nno-any: ${findings.length} finding(s). Types are required; unsound shortcuts are not.`);
process.exit(1);

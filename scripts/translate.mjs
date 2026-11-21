// Translates option descriptions through any OpenAI-compatible chat endpoint.
// Locally that is llama.cpp's llama-server with a ~0.5 GB model; in CI it is a
// larger one. Nothing here knows which, so the runtime is a command-line flag.
//
// Code spans, URLs and option names are swapped for [[n]] markers before the text leaves,
// and the health check rejects any translation that loses or reorders a marker. Small
// models eat fancy brackets (⟦0⟧, {{0}}), so the marker has to be plain ASCII.
import { readFileSync, writeFileSync } from "node:fs";

/** @typedef {"zh" | "ja"} Lang */
/** @typedef {{ marked: string, tokens: string[] }} Protected */
/** @typedef {{ ok: boolean, reason: string }} Check */
/** @typedef {{ baseUrl: string, model: string, lang: Lang, budget: number, limit: number, shard: number, shards: number }} Settings */

const PROTECTED = /`[^`]+`|https?:\/\/[^\s)\]]+|(?<![\w-])--[a-z0-9][a-z0-9-]*/g;
const MARKER = /\[\[(\d+)\]\]/g;

/** @type {Record<Lang, [string, string]>} */
const LANG_NAMES = {
    zh: ["Chinese (Simplified)", "zh-Hans"],
    ja: ["Japanese", "ja"],
};

const REFUSALS = ["I cannot", "I can't", "as an AI", "抱歉", "申し訳"];

/**
 * Markers replace anything that has to survive verbatim.
 * @param {string} text
 * @returns {Protected}
 */
export function protectText(text) {
    /** @type {string[]} */
    const tokens = [];
    const marked = text.replace(PROTECTED, (match) => {
        tokens.push(match);
        return `[[${tokens.length - 1}]]`;
    });
    return { marked, tokens };
}

/**
 * @param {string} translated
 * @param {string[]} tokens
 * @returns {string}
 */
export function restoreText(translated, tokens) {
    return translated.replace(MARKER, (whole, index) => tokens[Number(index)] ?? whole);
}

/**
 * The prompt Google documents for TranslateGemma; it also reads as a plain
 * instruction to a general chat model.
 * @param {string} text
 * @param {Lang} lang
 * @returns {string}
 */
export function translatePrompt(text, lang) {
    const [name, code] = LANG_NAMES[lang];
    return [
        `You are a professional English (en) to ${name} (${code}) translator. Your goal is to accurately`,
        "convey the meaning and nuances of the original English text while adhering to the target",
        `language's grammar, vocabulary, and cultural sensitivities. Produce only the ${name} translation,`,
        `without any additional explanations or commentary. Please translate the following English text into ${name}:`,
        "",
        "",
        text,
    ].join("\n");
}

/**
 * Enough target-language script to rule out an English echo.
 * @param {string} translated
 * @param {Lang} lang
 * @returns {boolean}
 */
function looksLikeTarget(translated, lang) {
    const visible = translated.replace(MARKER, "").replace(/[\s\p{P}\p{N}]/gu, "");
    if (visible.length === 0) return false;
    const han = visible.match(/\p{Script=Han}/gu)?.length ?? 0;
    if (lang === "zh") return han / visible.length >= 0.3;
    const kana = visible.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
    return kana > 0 && (han + kana) / visible.length >= 0.3;
}

/**
 * Rejects anything that would corrupt the page: lost markers, an untranslated echo,
 * a refusal, or a length that suggests truncation.
 * @param {Protected} source
 * @param {string} translated
 * @param {Lang} lang
 * @returns {Check}
 */
export function checkTranslation(source, translated, lang) {
    const text = translated.trim();
    if (text === "") return { ok: false, reason: "empty" };

    for (const refusal of REFUSALS) {
        if (text.includes(refusal)) return { ok: false, reason: `refusal: ${refusal}` };
    }

    const wanted = source.tokens.map((_, index) => index);
    const found = [...text.matchAll(MARKER)].map((match) => Number(match[1]));
    if (found.length !== wanted.length || found.some((value, index) => value !== wanted[index])) {
        return { ok: false, reason: `markers ${JSON.stringify(found)} != ${JSON.stringify(wanted)}` };
    }

    const sourceLength = source.marked.replace(/\s+/g, "").length;
    const targetLength = text.replace(/\s+/g, "").length;
    const ratio = targetLength / Math.max(sourceLength, 1);
    if (ratio < 0.3 || ratio > 3) return { ok: false, reason: `length ratio ${ratio.toFixed(2)}` };

    if (!looksLikeTarget(text, lang)) return { ok: false, reason: "output is not in the target language" };
    return { ok: true, reason: "" };
}

/**
 * @param {Settings} settings
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function chat(settings, prompt) {
    const res = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            model: settings.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            max_tokens: 1024,
            stream: false,
        }),
    });
    if (!res.ok) throw new Error(`inference failed: ${res.status} ${await res.text()}`);
    const payload = /** @type {{ choices?: { message?: { content?: string } }[] }} */ (await res.json());
    return payload.choices?.[0]?.message?.content ?? "";
}

/**
 * @param {string[]} argv
 * @returns {Settings}
 */
function parseArgs(argv) {
    /** @param {string} flag @param {string} fallback */
    const get = (flag, fallback) => {
        const index = argv.indexOf(flag);
        return index === -1 ? fallback : (argv[index + 1] ?? fallback);
    };
    const lang = get("--lang", "zh");
    if (lang !== "zh" && lang !== "ja") throw new Error(`--lang must be zh or ja, got ${lang}`);
    return {
        baseUrl: get("--base-url", "http://127.0.0.1:8099").replace(/\/$/, ""),
        model: get("--model", "local"),
        lang,
        budget: Number(get("--budget", "0")),
        limit: Number(get("--limit", "0")),
        shard: Number(get("--shard", "0")),
        shards: Math.max(Number(get("--shards", "1")), 1),
    };
}

/** @param {string[]} argv */
export async function run(argv) {
    const settings = parseArgs(argv);
    const data = /** @type {{ options: import("../src/types.js").Option[] }} */ (
        JSON.parse(readFileSync("site/data/options.json", "utf8"))
    );
    const cachePath = `site/data/trans.${settings.lang}.json`;

    /** @type {Record<string, string>} */
    let cache;
    try {
        cache = /** @type {Record<string, string>} */ (JSON.parse(readFileSync(cachePath, "utf8")));
    } catch {
        cache = {};
    }

    const pending = data.options
        .filter((option, index) => cache[option.textHash] === undefined && index % settings.shards === settings.shard)
        .slice(0, settings.limit > 0 ? settings.limit : undefined);

    // Used by the workflow to skip a shard, and by --dry-run locally.
    if (argv.includes("--dry-run")) {
        console.log(`${pending.length} pending for ${settings.lang} (shard ${settings.shard}/${settings.shards}, dry run)`);
        return;
    }

    console.log(`${pending.length} pending for ${settings.lang} (shard ${settings.shard}/${settings.shards})`);
    const started = Date.now();
    let translated = 0;
    let rejected = 0;
    /** Written next to the cache so CI failures are visible without admin access to logs. */
    /** @type {{ name: string, reason: string }[]} */
    const samples = [];

    for (const [index, option] of pending.entries()) {
        if (settings.budget > 0 && (Date.now() - started) / 1000 > settings.budget) {
            console.log(`budget reached after ${index} options`);
            break;
        }
        const source = protectText(option.en);
        let content;
        try {
            content = await chat(settings, translatePrompt(source.marked, settings.lang));
        } catch (error) {
            rejected += 1;
            const message = `unreachable: ${/** @type {Error} */ (error).message}`;
            console.error(`${option.name}: ${message}`);
            if (samples.length < 10) samples.push({ name: option.name, reason: message });
            continue;
        }
        const check = checkTranslation(source, content, settings.lang);
        if (!check.ok) {
            // Nothing is written on failure, so the next run simply retries it.
            rejected += 1;
            console.error(`${option.name}: rejected (${check.reason})`);
            if (samples.length < 10) samples.push({ name: option.name, reason: check.reason });
            continue;
        }
        cache[option.textHash] = restoreText(content.trim(), source.tokens);
        translated += 1;
        writeFileSync(cachePath, `${JSON.stringify(cache)}\n`);
    }

    console.log(
        `translated ${translated}, rejected ${rejected}, cache now ${Object.keys(cache).length} entries -> ${cachePath}`,
    );
    writeFileSync(
        `site/data/trans.${settings.lang}.report.json`,
        `${JSON.stringify({ lang: settings.lang, shard: settings.shard, pending: pending.length, translated, rejected, samples })}
`,
    );
}

if (import.meta.main) await run(process.argv.slice(2));

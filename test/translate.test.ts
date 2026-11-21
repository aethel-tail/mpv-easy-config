import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTranslation, protectText, restoreText, translatePrompt } from "../scripts/translate.mjs";

const source = protectText("Set the `--vo=gpu` driver; see [the manual](https://mpv.io) for `hwdec`.");

test("protects code spans, urls and bare option names", () => {
    assert.deepEqual(source.tokens, ["`--vo=gpu`", "https://mpv.io", "`hwdec`"]);
    assert.equal(source.marked, "Set the [[0]] driver; see [the manual]([[1]]) for [[2]].");
});

test("leaves ordinary prose and single dashes alone", () => {
    const plain = protectText("Use a well-known value - it is safe.");
    assert.deepEqual(plain.tokens, []);
    assert.equal(plain.marked, "Use a well-known value - it is safe.");
});

test("restores markers in place", () => {
    assert.equal(
        restoreText("设置 [[0]] 驱动；参见 [[1]] 中的 [[2]]。", source.tokens),
        "设置 `--vo=gpu` 驱动；参见 https://mpv.io 中的 `hwdec`。",
    );
});

test("prompt keeps the documented two blank lines before the text", () => {
    const prompt = translatePrompt("hello", "zh");
    assert.match(prompt, /text into Chinese \(Simplified\):\n\n\nhello$/);
});

test("accepts a good translation", () => {
    const check = checkTranslation(source, "设置 [[0]] 驱动；详情参见 [[1]] 里的 [[2]]。", "zh");
    assert.deepEqual(check, { ok: true, reason: "" });
});

test("rejects a translation that drops a marker", () => {
    const check = checkTranslation(source, "设置 [[0]] 驱动；参见手册里的 [[2]]。", "zh");
    assert.equal(check.ok, false);
    assert.match(check.reason, /markers/);
});

test("rejects reordered markers", () => {
    assert.equal(checkTranslation(source, "[[1]] 设置 [[0]] 与 [[2]]。", "zh").ok, false);
});

test("rejects an untranslated echo", () => {
    const check = checkTranslation(source, "Set the [[0]] driver; see [the manual]([[1]]) for [[2]].", "zh");
    assert.equal(check.ok, false);
    assert.match(check.reason, /target language/);
});

test("rejects refusals and empty output", () => {
    assert.match(checkTranslation(source, "I cannot translate this.", "zh").reason, /refusal/);
    assert.match(checkTranslation(source, "   ", "zh").reason, /empty/);
});

test("rejects output that is markers only", () => {
    assert.equal(checkTranslation(source, "[[0]][[1]][[2]]", "zh").ok, false);
});

test("japanese needs kana, pure kanji from Chinese is not accepted", () => {
    assert.equal(checkTranslation(source, "[[0]]驱动 参见[[1]]的[[2]]", "ja").ok, false);
    assert.equal(checkTranslation(source, "[[0]]ドライバを設定し、[[1]]の[[2]]を参照。", "ja").ok, true);
});

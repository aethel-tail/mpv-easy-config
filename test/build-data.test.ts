import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeOptions } from "../scripts/build-data.mjs";

const parsed = [
    { name: "vo", section: "Video", en: "Video output driver." },
    { name: "gpu-only", section: "GPU renderer options", en: "Only in the manual." },
    { name: "vo", section: "Video", en: "Duplicate term, must be ignored." },
];
const metas: import("../scripts/list-options.mjs").OptionMeta[] = [
    { name: "vo", widget: { kind: "choice", choices: ["gpu"], def: "gpu" }, file: false, deprecated: false },
    { name: "not-in-manual", widget: { kind: "flag", def: true }, file: false, deprecated: false },
];
const versions = { mpvCommit: "deadbeef", mpvVersion: "mpv 0.41.0" };

const data = mergeOptions(parsed, metas, versions);
const byName = new Map(data.options.map((o) => [o.name, o]));

test("takes the widget from the mpv metadata", () => {
    assert.deepEqual(byName.get("vo")?.widget, { kind: "choice", choices: ["gpu"], def: "gpu" });
});

test("degrades options the mpv build does not know to a text widget", () => {
    assert.deepEqual(byName.get("gpu-only")?.widget, { kind: "text", def: "" });
    assert.deepEqual(data.degraded, ["gpu-only"]);
});

test("drops options that have metadata but no documented description", () => {
    assert.equal(byName.has("not-in-manual"), false);
    assert.deepEqual(data.undocumented, ["not-in-manual"]);
});

test("keeps the first of duplicated terms", () => {
    assert.equal(byName.get("vo")?.en, "Video output driver.");
    assert.equal(data.options.length, 2);
});

test("hashes the English text for the translation cache", () => {
    assert.equal(byName.get("vo")?.textHash.length, 12);
    assert.notEqual(byName.get("vo")?.textHash, byName.get("gpu-only")?.textHash);
});

test("derives the manual section anchor", () => {
    assert.equal(byName.get("gpu-only")?.sectionAnchor, "gpu-renderer-options");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMpvConf, countModified, parseMpvConf } from "../src/mpvconf.ts";
import type { Option } from "../src/types.ts";

const base = { en: "", textHash: "x", file: false, deprecated: false, section: "Video", sectionAnchor: "video" };

const options: Option[] = [
    { ...base, name: "osc", widget: { kind: "flag", def: true } },
    { ...base, name: "hwdec", widget: { kind: "list", def: "no" } },
    { ...base, name: "vo", widget: { kind: "list", def: "" } },
    { ...base, name: "scale", widget: { kind: "choice", choices: ["lanczos", "bilinear"], def: "lanczos" } },
    { ...base, name: "volume", widget: { kind: "number", min: 0, max: 1000, def: "100" } },
    { ...base, name: "sub-file", widget: { kind: "text", def: "" }, file: true },
    { ...base, name: "geometry", widget: { kind: "text", def: "" } },
];

test("emits nothing when every value equals its default", () => {
    assert.equal(buildMpvConf(options, {}), "");
    assert.equal(buildMpvConf(options, { osc: true, scale: "lanczos" }), "");
});

test("omits the header when nothing is modified", () => {
    assert.equal(buildMpvConf(options, {}, "mpv-easy-config"), "");
});

test("writes flags as bare names and negations as no- prefixed names", () => {
    assert.equal(buildMpvConf(options, { osc: false }), "no-osc\n");
});

test("writes one line per modified option, sorted by name", () => {
    const conf = buildMpvConf(options, { vo: "gpu", scale: "bilinear", volume: "80" });
    assert.equal(conf, "scale=bilinear\nvo=gpu\nvolume=80\n");
});

test("omits an emptied text field instead of writing a broken assignment", () => {
    assert.equal(buildMpvConf(options, { "sub-file": "   " }), "");
});

test("keeps spaces and inner quotes in values", () => {
    const conf = buildMpvConf(options, { "sub-file": 'my file "x".sup' });
    assert.equal(conf, 'sub-file=my file "x".sup\n');
    assert.deepEqual(parseMpvConf(conf, options).values, { "sub-file": 'my file "x".sup' });
});

test("round-trips booleans, choices, numbers, lists and text", () => {
    const values = { osc: false, hwdec: "auto-safe", vo: "gpu,gpu-next", scale: "bilinear", volume: "80", geometry: "50%:50%" };
    const parsed = parseMpvConf(buildMpvConf(options, values), options);
    assert.deepEqual(parsed.values, values);
    assert.deepEqual(parsed.unknown, []);
});

test("imports a hand-written config, ignoring comments and -- prefixes", () => {
    const conf = ["# my config", "--volume=70", "hwdec=auto", "no-osc", "scale=bilinear", ""].join("\n");
    assert.deepEqual(parseMpvConf(conf, options).values, { volume: "70", hwdec: "auto", osc: false, scale: "bilinear" });
});

test("strips quotes that wrap a whole value", () => {
    assert.deepEqual(parseMpvConf('sub-file="a b.sup"', options).values, { "sub-file": "a b.sup" });
});

test("reports unknown keys instead of dropping them", () => {
    const parsed = parseMpvConf("volume=70\naudio-file=x.mka\nnonsense=1", options);
    assert.deepEqual(parsed.unknown, ["audio-file", "nonsense"]);
    assert.deepEqual(parsed.values, { volume: "70" });
});

test("counts modified options", () => {
    assert.equal(countModified(options, { osc: true, scale: "bilinear" }), 1);
    assert.equal(countModified(options, {}), 0);
});

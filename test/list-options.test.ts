import assert from "node:assert/strict";
import { test } from "node:test";
import { parseListOptions } from "../scripts/list-options.mjs";

// Reconstructed from m_config_print_option_list(): " --name<pad 30><type>…". The
// type names are the real ones from mpv's options/m_option.c.
const FIXTURE = `Options:

 --alang                        String list (default: )
 --vo                           Choices: auto gpu gpu-next dmabuf-wayland (default: gpu)
 --aid                          Choices: no auto yes (or an integer) (default: auto)
 --contrast                     Float (-100 to 100) (default: 0)
 --volume                       Float (0 to 1000) (default: 100)
 --corner-rounding              Integer (0 to 32) (default: 0)
 --demuxer-max-bytes            ByteSize (0 to 9223372036854775807) (default: 256MiB)
 --scale-param1                 Complex (default: 0.0)
 --background-color             Color (default: 0.0/0.0/0.0/0.0)
 --screenshot-sw                Flag (default: no)
 --osc                          Flag (default: yes)
 --mute                         Flag (default: no)
 --sub-file                     String (default: ) [file]
 --geometry                     String (default: ) [deprecated]
 --screenshot-format            Choices: jpg png webp (default: jpg) [not in config files]
 --volume-alias                 Flag (default: no) for volume
 --audio-device-add             String (default: ) for --audio-device (CLI/config files only)
    --vo-extra                 an action variant line, indented under its parent
 --a-very-long-option-name-which-overflows-the-column  String (default: x)
 --mute                         Flag (default: yes)
Total: 19 options
`;

const metas = parseListOptions(FIXTURE);
const byName = new Map(metas.map((m) => [m.name, m]));

test("parses flags into a boolean default", () => {
    assert.deepEqual(byName.get("screenshot-sw")?.widget, { kind: "flag", def: false });
    assert.deepEqual(byName.get("osc")?.widget, { kind: "flag", def: true });
});

test("choice lists drop the '(or an integer)' suffix", () => {
    assert.deepEqual(byName.get("vo")?.widget, { kind: "choice", choices: ["auto", "gpu", "gpu-next", "dmabuf-wayland"], def: "gpu" });
    assert.deepEqual(byName.get("aid")?.widget, { kind: "choice", choices: ["no", "auto", "yes"], def: "auto" });
});

test("numeric ranges become slider bounds", () => {
    assert.deepEqual(byName.get("contrast")?.widget, { kind: "number", min: -100, max: 100, def: "0" });
    assert.deepEqual(byName.get("corner-rounding")?.widget, { kind: "number", min: 0, max: 32, def: "0" });
});

test("byte sizes keep their suffix and degrade to text", () => {
    assert.deepEqual(byName.get("demuxer-max-bytes")?.widget, { kind: "text", def: "256MiB" });
});

test("string list stays a list widget with the raw default", () => {
    assert.deepEqual(byName.get("alang")?.widget, { kind: "list", def: "" });
});

test("unknown types fall back to text", () => {
    assert.equal(byName.get("scale-param1")?.widget.kind, "text");
    assert.equal(byName.get("background-color")?.widget.kind, "text");
});

test("defaults containing slashes and parentheses survive intact", () => {
    assert.deepEqual(byName.get("background-color")?.widget, { kind: "text", def: "0.0/0.0/0.0/0.0" });
});

test("[file] is exposed as a hint", () => {
    assert.equal(byName.get("sub-file")?.file, true);
    assert.equal(byName.get("sub-file")?.deprecated, false);
});

test("[not in config files] options are dropped", () => {
    assert.equal(byName.has("screenshot-format"), false);
});

test("[deprecated] is recorded", () => {
    assert.equal(byName.get("geometry")?.deprecated, true);
});

test("alias entries are dropped", () => {
    assert.equal(byName.has("audio-device-add"), false);
});

test("indented action variants are not options", () => {
    assert.equal(byName.has("vo-extra"), false);
});

test("a name longer than the column still parses", () => {
    assert.deepEqual(byName.get("a-very-long-option-name-which-overflows-the-column")?.widget, { kind: "text", def: "x" });
});

test("first occurrence wins on duplicates", () => {
    assert.deepEqual(byName.get("mute")?.widget, { kind: "flag", def: false });
});

test("banners and the total line are ignored", () => {
    assert.equal(metas.some((m) => m.name.includes("Options") || m.name.includes("Total")), false);
    assert.equal(metas.length, 15);
});

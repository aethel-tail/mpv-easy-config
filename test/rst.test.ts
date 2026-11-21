import assert from "node:assert/strict";
import { test } from "node:test";
import { headerNames, parseOptionsRst, sectionAnchor } from "../scripts/rst.mjs";

const FIXTURE = `OPTIONS
=======

Track Selection
---------------

\`\`--alang=<code[,code,...]>\`\`, \`\`--slang=<code>\`\`
    Specify a prioritized list of audio languages. See \`List Options\`_ for
    details and \`\`--aid\`\` for the alias behaviour.

    .. admonition:: Examples

        - \`\`mpv --alang=jpn file.mkv\`\` picks Japanese.

\`\`--aid=<ID|auto|no>\`\`
    Select audio track.

Video
-----

\`\`--vo=<driver>\`\`
    See \`the list <https://mpv.io/manual/master/>\`__ for available drivers.

    \`\`--vo-add=<driver>\`\`
        Appends to the driver list.
`;

const parsed = parseOptionsRst(FIXTURE);
const byName = new Map(parsed.map((o) => [o.name, o]));

test("declares one entry per name in a shared term line", () => {
    assert.deepEqual(
        parsed.map((o) => o.name),
        ["alang", "slang", "aid", "vo"],
    );
});

test("names sharing a term line share the same description", () => {
    assert.equal(byName.get("slang")?.en, byName.get("alang")?.en);
});

test("assigns the enclosing level-2 heading as section", () => {
    assert.equal(byName.get("alang")?.section, "Track Selection");
    assert.equal(byName.get("vo")?.section, "Video");
});

test("ignores indented term lines, which are action variants of the parent", () => {
    assert.equal(byName.has("vo-add"), false);
});

test("reflows hard-wrapped paragraphs onto one line", () => {
    const first = byName.get("alang")?.en.split("\n")[0] ?? "";
    assert.match(first, /See List Options for details and `--aid` for the alias behaviour\.$/);
});

test("turns admonitions into a bold label with the block pulled up", () => {
    const en = byName.get("alang")?.en ?? "";
    assert.match(en, /^\*\*Examples\*\*$/m);
    assert.match(en, /^- `mpv --alang=jpn file\.mkv` picks Japanese\.$/m);
});

test("resolves internal references and external links", () => {
    assert.match(byName.get("alang")?.en ?? "", /See List Options for/);
    assert.match(byName.get("vo")?.en ?? "", /\[the list\]\(https:\/\/mpv\.io\/manual\/master\/\)/);
});

test("headerNames rejects prose that merely starts with a literal", () => {
    assert.deepEqual(headerNames("``--loop-file=<N|inf|no>``, ``--loop=<N|inf|no>``"), ["loop-file", "loop"]);
    assert.equal(headerNames("``--foo`` is great"), null);
    assert.equal(headerNames("--foo=<x>"), null);
});

test("sectionAnchor matches the ids used on mpv.io", () => {
    assert.equal(sectionAnchor("GPU renderer options"), "gpu-renderer-options");
    assert.equal(sectionAnchor("Network backend (libcurl)"), "network-backend-libcurl");
    assert.equal(sectionAnchor("Track Selection"), "track-selection");
});

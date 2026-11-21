import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprint, pendingCount } from "../scripts/plan.mjs";

test("ignores the timestamp when comparing data revisions", () => {
    const first = { generatedAt: "2026-01-01T00:00:00Z", mpvCommit: "a", options: [1, 2] };
    const second = { generatedAt: "2026-06-06T00:00:00Z", mpvCommit: "a", options: [1, 2] };
    assert.equal(fingerprint(first), fingerprint(second));
});

test("detects a real content change", () => {
    const first = { generatedAt: "x", options: [{ name: "a", widget: { kind: "text", def: "" } }] };
    const second = { generatedAt: "x", options: [{ name: "a", widget: { kind: "flag", def: false } }] };
    assert.notEqual(fingerprint(first), fingerprint(second));
});

test("counts a hash as pending until every language has it", () => {
    const options = [{ textHash: "a" }, { textHash: "b" }, { textHash: "a" }];
    assert.equal(pendingCount(options, [{}, {}]), 2);
    assert.equal(pendingCount(options, [{ a: "x", b: "y" }, { a: "x", b: "y" }]), 0);
    assert.equal(pendingCount(options, [{ a: "x", b: "y" }, { a: "x" }]), 1);
});

test("counts nothing when there are no options", () => {
    assert.equal(pendingCount([], [{}, {}]), 0);
});

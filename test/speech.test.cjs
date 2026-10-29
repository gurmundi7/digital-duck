const test = require("node:test");
const assert = require("node:assert");
const { spokenCut, sentencesOf } = require("../electron/speech.cjs");

test("short text is spoken as is", () => {
  assert.strictEqual(spokenCut("Quack! Something for you."), "Quack! Something for you.");
});

test("a long briefing is cut to two sentences", () => {
  const briefing = "Something for you, boss. Three PRs need your eyes, two Slack asks aged past a day. " +
    "One PR has a failing test. Sam asked about the new logo in #design. Your first meeting is at ten.";
  assert.strictEqual(spokenCut(briefing), "Something for you, boss. Three PRs need your eyes, two Slack asks aged past a day.");
});

test("markdown and newlines are stripped before counting", () => {
  assert.strictEqual(spokenCut("*Nightly* review:\n- one\n- two. Done."), "Nightly review: - one - two. Done.");
});

test("one run-on sentence is cut at a word boundary with an ellipsis", () => {
  const long = "word ".repeat(80).trim();
  const said = spokenCut(long, { maxChars: 60 });
  assert.ok(said.length <= 60, said);
  assert.ok(said.endsWith("…"));
  assert.ok(!said.includes("wor…"));
});

test("sentence endings with quotes and ellipses are kept with their sentence", () => {
  assert.deepStrictEqual(sentencesOf('He said "no." Then left… Fine?'), ['He said "no."', "Then left…", "Fine?"]);
});

test("empty input says nothing", () => {
  assert.strictEqual(spokenCut(""), "");
  assert.strictEqual(spokenCut(null), "");
});

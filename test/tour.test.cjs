const test = require("node:test");
const assert = require("node:assert");
const { tourDue, brainStatus, brainChoices, TRY_PHRASES } = require("../electron/tour.cjs");

test("the tour opens for a new install and not for an owner from before it existed", () => {
  assert.strictEqual(tourDue(null), true);
  assert.strictEqual(tourDue({ onboarded: false }), true);
  assert.strictEqual(tourDue({ provider: "auto" }), false);
  assert.strictEqual(tourDue({ onboarded: true }), false);
});

test("a CLI brain is ready only when its binary was found", () => {
  assert.deepStrictEqual(brainStatus({ provider: "codex", bins: { codex: "/opt/homebrew/bin/codex" } }), { ready: true, label: "Codex CLI" });
  assert.deepStrictEqual(brainStatus({ provider: "codex", bins: { codex: null } }), { ready: false, label: "Codex CLI", need: "install" });
});

test("an API brain needs a key, except OpenAI pointed at another server", () => {
  assert.deepStrictEqual(brainStatus({ provider: "anthropic", hasKey: false }), { ready: false, label: "Anthropic API", need: "key" });
  assert.deepStrictEqual(brainStatus({ provider: "gemini", hasKey: true }), { ready: true, label: "Gemini API" });
  assert.strictEqual(brainStatus({ provider: "openai", baseUrl: "http://localhost:11434/v1" }).ready, true);
  assert.strictEqual(brainStatus({ provider: "openai", baseUrl: "https://api.openai.com/v1" }).ready, false);
});

test("an unknown provider asks the owner to pick one", () => {
  assert.strictEqual(brainStatus({ provider: "nope" }).need, "pick");
});

test("choices list installed CLIs first, then every API with where to get its key", () => {
  const choices = brainChoices({ claude: null, codex: "/bin/codex", "gemini-cli": null });
  assert.deepStrictEqual(choices.map((c) => c.id), ["codex", "anthropic", "openai", "gemini"]);
  assert.ok(choices.filter((c) => c.kind === "api").every((c) => c.keyUrl));
  assert.deepStrictEqual(brainChoices({}, { openai: true }).filter((c) => c.hasKey).map((c) => c.id), ["openai"]);
});

test("every phrase marked as needing no brain is one the duck reads from the words", () => {
  // Mirrors the renderer's IMPLIED table and its remind rule (renderer/src/main.js).
  const moves = [/\b(sit|take a seat|sit down|lie down)\b/i, /\broll( over)?\b|somersault|\bflip\b/i, /\b(skate|skating|roller|rollers|wheels)\b/i, /\b(play|fetch|football|soccer)\b|\bball\b(?!.*\b(away|gone|remove)\b)/i, /\bremind\b|\breminder\b/i];
  for (const p of TRY_PHRASES.filter((t) => !t.brain)) assert.ok(moves.some((re) => re.test(p.text)), p.text);
});

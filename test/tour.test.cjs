const test = require("node:test");
const assert = require("node:assert");
const { tourDue, brainStatus, setupChoices, setupGuide, tourUrls, tourCommands, pickOllamaModel, explainError, TRY_PHRASES } = require("../electron/tour.cjs");

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
  assert.deepStrictEqual(brainStatus({ provider: "openai", baseUrl: "http://localhost:11434/v1" }), { ready: true, label: "Ollama on this Mac" });
  assert.strictEqual(brainStatus({ provider: "openai", baseUrl: "https://api.openai.com/v1" }).ready, false);
});

test("an unknown provider asks the owner to pick one", () => {
  assert.strictEqual(brainStatus({ provider: "nope" }).need, "pick");
});

test("someone with nothing set up gets only the guided choices", () => {
  assert.deepStrictEqual(setupChoices({}).map((c) => c.id), ["claude", "codex", "gemini", "ollama", "key"]);
});

test("what is already on the Mac comes first and needs no steps", () => {
  const ids = setupChoices({ bins: { codex: "/bin/codex", claude: null }, keys: { openai: true } }).map((c) => c.id);
  assert.deepStrictEqual(ids, ["use:codex", "use:openai", "claude", "gemini", "ollama", "key"]);
  assert.deepStrictEqual(setupGuide("use:codex").steps, []);
  assert.deepStrictEqual(setupGuide("use:openai").check, { kind: "api", provider: "openai" });
});

test("Codex installs with whatever this Mac has, and sends a Mac with neither to Homebrew", () => {
  const command = (env) => setupGuide("codex", env).steps.find((s) => s.command)?.command;
  assert.strictEqual(command({ brew: true, npm: true }), "brew install --cask codex");
  assert.strictEqual(command({ npm: true }), "npm i -g @openai/codex");
  assert.strictEqual(command({}), "brew install --cask codex");
  assert.strictEqual(setupGuide("codex", {}).steps[0].url, "https://brew.sh");
  assert.ok(!setupGuide("codex", { brew: true }).steps.some((s) => s.url));
});

test("every guide ends in something the tour can check", () => {
  for (const id of ["claude", "codex", "gemini", "ollama", "key"]) {
    const guide = setupGuide(id, {});
    assert.ok(["cli", "api", "ollama"].includes(guide.check.kind), id);
    assert.ok(guide.steps.length > 0, id);
  }
  assert.strictEqual(setupGuide("nope"), null);
});

test("the tour opens and copies only what its guides show", () => {
  assert.deepStrictEqual(tourUrls().sort(), ["https://aistudio.google.com/apikey", "https://brew.sh", "https://ollama.com/download"]);
  assert.ok(tourCommands().includes("npm i -g @openai/codex"));
  assert.ok(tourCommands().includes("ollama pull llama3.2"));
  assert.ok(!tourCommands().some((c) => /rm |sudo/.test(c)));
});

test("Ollama talks to the pulled model when there is one", () => {
  assert.strictEqual(pickOllamaModel(["qwen2.5:7b", "llama3.2:latest"]), "llama3.2:latest");
  assert.strictEqual(pickOllamaModel(["qwen2.5:7b"]), "qwen2.5:7b");
  assert.strictEqual(pickOllamaModel([]), null);
});

test("brain errors become a next step someone new can take", () => {
  assert.match(explainError("Codex CLI isn't installed: pick another brain", { provider: "codex" }), /can't find Codex CLI/);
  assert.match(explainError("Not logged in. Please run /login", { provider: "claude" }), /Run "claude" in Terminal and sign in/);
  assert.match(explainError("Incorrect API key provided", { provider: "openai" }), /refused the key/);
  assert.match(explainError("You exceeded your current quota", { provider: "openai" }), /out of credit/);
  assert.match(explainError("network: fetch failed", { provider: "openai", baseUrl: "http://localhost:11434/v1" }), /Open the Ollama app/);
  assert.match(explainError("network: fetch failed", { provider: "gemini" }), /internet connection/);
  assert.match(explainError("something odd", { provider: "gemini" }), /^Gemini API said: something odd/);
});

test("every phrase marked as needing no brain is one the duck reads from the words", () => {
  // Mirrors the renderer's IMPLIED table and its remind rule (renderer/src/main.js).
  const moves = [/\b(sit|take a seat|sit down|lie down)\b/i, /\broll( over)?\b|somersault|\bflip\b/i, /\b(skate|skating|roller|rollers|wheels)\b/i, /\b(play|fetch|football|soccer)\b|\bball\b(?!.*\b(away|gone|remove)\b)/i, /\bremind\b|\breminder\b/i];
  for (const p of TRY_PHRASES.filter((t) => !t.brain)) assert.ok(moves.some((re) => re.test(p.text)), p.text);
});

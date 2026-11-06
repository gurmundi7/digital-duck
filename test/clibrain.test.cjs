const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createCliBrain } = require("../electron/clibrain.cjs");

function fakeSpawn({ stdout = "", stderr = "", code = 0 }) {
  const calls = [];
  const fn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.kill = () => {};
    setImmediate(() => { child.stdout.emit("data", stdout); child.stderr.emit("data", stderr); child.emit("close", code); });
    return child;
  };
  return { fn, calls };
}
const stateDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "duck-cli-"));

test("codex answers from its own folder, with the persona in AGENTS.md and the thread id kept", async () => {
  const dir = stateDir();
  const { fn, calls } = fakeSpawn({ stdout: '{"type":"thread.started","thread_id":"t-9"}\n{"type":"item.completed","item":{"type":"agent_message","text":"Quack."}}\n' });
  const brain = createCliBrain({ provider: "codex", spawn: fn, bin: "/bin/codex", stateDir: dir });
  const r = await brain.ask({ prompt: "hi", persona: "You are Duck.", model: "", level: "chat" });
  assert.deepStrictEqual(r, { text: "Quack.", sessionId: "t-9" });
  assert.strictEqual(calls[0].opts.cwd, path.join(dir, "codex"));
  assert.strictEqual(fs.readFileSync(path.join(dir, "codex", "AGENTS.md"), "utf8"), "You are Duck.\n");
});

test("gemini CLI gets GEMINI.md and the owner's MCP servers only when connectors are on", async () => {
  const dir = stateDir();
  const { fn } = fakeSpawn({ stdout: '{"response":"Hi!"}' });
  const brain = createCliBrain({ provider: "gemini-cli", spawn: fn, bin: "/bin/gemini", stateDir: dir });
  const servers = { files: { command: "npx" } };
  assert.deepStrictEqual(await brain.ask({ prompt: "hi", persona: "P", level: "chat", mcp: false, mcpServers: servers }), { text: "Hi!", sessionId: "latest" });
  const settings = () => JSON.parse(fs.readFileSync(path.join(dir, "gemini", ".gemini", "settings.json"), "utf8"));
  assert.deepStrictEqual(settings(), { mcpServers: {} });
  await brain.ask({ prompt: "hi", persona: "P", level: "chat", mcp: true, mcpServers: servers });
  assert.deepStrictEqual(settings(), { mcpServers: servers });
  assert.ok(fs.existsSync(path.join(dir, "gemini", "GEMINI.md")));
});

test("a CLI that fails reports its last stderr line", async () => {
  const { fn } = fakeSpawn({ stdout: "", stderr: "warming up\nNot logged in. Run codex login.", code: 1 });
  const brain = createCliBrain({ provider: "codex", spawn: fn, bin: "/bin/codex", stateDir: stateDir() });
  assert.deepStrictEqual(await brain.ask({ prompt: "hi", persona: "P", level: "chat" }), { text: "", error: "Not logged in. Run codex login." });
});

const { withCliKey } = require("../electron/clibrain.cjs");
const keys = { openai: "sk-saved", gemini: "AIza-saved" };
const readKey = async (p) => keys[p] ?? null;

test("Codex with no login of its own gets the saved OpenAI key", async () => {
  const env = await withCliKey("codex", { PATH: "/bin" }, { readKey, loggedIn: async () => false });
  assert.strictEqual(env.CODEX_API_KEY, "sk-saved");
});

test("a Codex ChatGPT login is never overridden by the saved key", async () => {
  const env = await withCliKey("codex", { PATH: "/bin" }, { readKey, loggedIn: async () => true });
  assert.strictEqual(env.CODEX_API_KEY, undefined);
});

test("a key in the shell wins, and the login is not even checked", async () => {
  let asked = false;
  const env = await withCliKey("codex", { CODEX_API_KEY: "sk-shell" }, { readKey, loggedIn: async () => { asked = true; return false; } });
  assert.strictEqual(env.CODEX_API_KEY, "sk-shell");
  assert.strictEqual(asked, false);
  const gem = await withCliKey("gemini-cli", { GOOGLE_API_KEY: "AIza-shell" }, { readKey, loggedIn: async () => false });
  assert.strictEqual(gem.GEMINI_API_KEY, undefined);
});

test("Gemini CLI gets the saved Gemini key; with nothing saved the env is unchanged", async () => {
  const env = await withCliKey("gemini-cli", {}, { readKey, loggedIn: async () => false });
  assert.strictEqual(env.GEMINI_API_KEY, "AIza-saved");
  const none = await withCliKey("codex", { PATH: "/bin" }, { readKey: async () => null, loggedIn: async () => false });
  assert.deepStrictEqual(none, { PATH: "/bin" });
});

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createApiBrain, saveKey, readKey, validKey } = require("../electron/apibrain.cjs");
const { modelId } = require("../electron/providers.cjs");

const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

function fakeSpawn() {
  const calls = [];
  const fn = (cmd, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: (data) => { calls.push({ cmd, args, stdin: data }); setImmediate(() => child.emit("close", 0)); } };
    return child;
  };
  return { fn, calls };
}

test("the key reaches security on stdin, never as an argument", async () => {
  const { fn, calls } = fakeSpawn();
  const r = await saveKey(KEY, { spawnFn: fn });
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].args, ["-i"]);
  assert.ok(!calls[0].args.join(" ").includes(KEY));
  assert.match(calls[0].stdin, /^add-generic-password -U -s "Digital Duck" -a "anthropic-api-key" -w "sk-ant-/);
});

test("something that is not a key is refused before touching the Keychain", async () => {
  const { fn, calls } = fakeSpawn();
  const r = await saveKey('sk-ant-x" ; delete-keychain', { spawnFn: fn });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(validKey("hello"), false);
  assert.strictEqual(validKey(KEY), true);
});

test("without a key the brain explains itself and makes no request", async () => {
  let fetched = false;
  const brain = createApiBrain({ historyPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "duck-")), "h.json"), keyFn: async () => null, fetchFn: async () => { fetched = true; } });
  const r = await brain.ask({ text: "hi", system: "s", model: "haiku" });
  assert.match(r.error, /API key/);
  assert.strictEqual(fetched, false);
});

test("a reply is returned, the conversation carries on, and the key is never written to disk", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duck-"));
  const historyPath = path.join(dir, "h.json");
  const sent = [];
  const fetchFn = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "Quack. [sit]" }] }) };
  };
  const brain = createApiBrain({ historyPath, keyFn: async () => KEY, fetchFn });
  assert.deepStrictEqual(await brain.ask({ text: "sit", system: "persona", model: "haiku" }), { text: "Quack. [sit]" });
  await brain.ask({ text: "again", system: "persona", model: "haiku" });
  assert.strictEqual(sent[0].init.headers["x-api-key"], KEY);
  assert.strictEqual(sent[0].body.model, modelId("anthropic", "haiku"));
  assert.strictEqual(sent[1].body.messages.length, 3);
  for (const f of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, f), "utf8").includes(KEY));
});

const OPENAI_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";
const GEMINI_KEY = "AIzaSyAbcdefghijklmnopqrstuvwxyz0123456";

test("each provider's key is checked against its own shape and kept under its own Keychain account", async () => {
  assert.strictEqual(validKey(OPENAI_KEY, "openai"), true);
  assert.strictEqual(validKey(GEMINI_KEY, "gemini"), true);
  assert.strictEqual(validKey(OPENAI_KEY, "gemini"), false);
  assert.strictEqual(validKey('sk-abcdefghijklmnopqrstuvwxyz"; delete', "openai"), false);
  const { fn, calls } = fakeSpawn();
  assert.deepStrictEqual(await saveKey(GEMINI_KEY, { provider: "gemini", spawnFn: fn }), { ok: true });
  assert.match(calls[0].stdin, /-a "gemini-api-key" -w "AIza/);
  const r = await saveKey(GEMINI_KEY, { provider: "openai", spawnFn: fn });
  assert.match(r.error, /OpenAI API key/);
});

test("an empty Keychain falls back to the provider's environment variable", async () => {
  const none = (_cmd, _args, cb) => cb(new Error("not found"));
  assert.strictEqual(await readKey("openai", { execFileFn: none, env: { OPENAI_API_KEY: OPENAI_KEY } }), OPENAI_KEY);
  assert.strictEqual(await readKey("gemini", { execFileFn: none, env: { GOOGLE_API_KEY: GEMINI_KEY } }), GEMINI_KEY);
  assert.strictEqual(await readKey("anthropic", { execFileFn: none, env: {} }), null);
});

function recordingFetch(reply) {
  const sent = [];
  const fetchFn = async (url, init) => { sent.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return { ok: true, json: async () => reply }; };
  return { fetchFn, sent };
}
const freshHistory = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "duck-")), "h.json");

test("OpenAI itself gets the Responses API with the persona as instructions, and web search on lookup", async () => {
  const { fetchFn, sent } = recordingFetch({ output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "Quack from GPT." }] }] });
  const brain = createApiBrain({ historyPath: freshHistory(), keyFn: async () => OPENAI_KEY, fetchFn });
  assert.deepStrictEqual(await brain.ask({ provider: "openai", text: "hi", system: "persona", model: "gpt-6-luna", lookup: true }), { text: "Quack from GPT." });
  assert.strictEqual(sent[0].url, "https://api.openai.com/v1/responses");
  assert.strictEqual(sent[0].headers.authorization, `Bearer ${OPENAI_KEY}`);
  assert.strictEqual(sent[0].body.instructions, "persona");
  assert.deepStrictEqual(sent[0].body.input, [{ role: "user", content: "hi" }]);
  assert.deepStrictEqual(sent[0].body.tools, [{ type: "web_search" }]);
});

test("any other base URL is an OpenAI-compatible server: Chat Completions, and no key needed", async () => {
  const { fetchFn, sent } = recordingFetch({ choices: [{ message: { content: "Local quack." } }] });
  const brain = createApiBrain({ historyPath: freshHistory(), keyFn: async () => null, fetchFn });
  const r = await brain.ask({ provider: "openai", text: "hi", system: "persona", model: "llama3.2", baseUrl: "http://localhost:11434/v1/" });
  assert.deepStrictEqual(r, { text: "Local quack." });
  assert.strictEqual(sent[0].url, "http://localhost:11434/v1/chat/completions");
  assert.strictEqual(sent[0].headers.authorization, undefined);
  assert.deepStrictEqual(sent[0].body.messages[0], { role: "system", content: "persona" });
});

test("Gemini gets its own roles, the persona as systemInstruction, and Google Search on lookup", async () => {
  const { fetchFn, sent } = recordingFetch({ candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "Gemini quack." }] } }] });
  const brain = createApiBrain({ historyPath: freshHistory(), keyFn: async () => GEMINI_KEY, fetchFn });
  await brain.ask({ provider: "gemini", text: "one", system: "persona", model: "gemini-3.6-flash" });
  assert.deepStrictEqual(await brain.ask({ provider: "gemini", text: "two", system: "persona", model: "gemini-3.6-flash", lookup: true }), { text: "Gemini quack." });
  assert.strictEqual(sent[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
  assert.strictEqual(sent[0].headers["x-goog-api-key"], GEMINI_KEY);
  assert.deepStrictEqual(sent[1].body.systemInstruction, { parts: [{ text: "persona" }] });
  assert.deepStrictEqual(sent[1].body.contents.map((c) => c.role), ["user", "model", "user"]);
  assert.deepStrictEqual(sent[1].body.tools, [{ google_search: {} }]);
  assert.strictEqual(sent[0].body.tools, undefined);
});

test("an API error comes back as a short message, and the history keeps only answered turns", async () => {
  const fetchFn = async () => ({ ok: false, status: 400, json: async () => [{ error: { message: "API key not valid." } }] });
  const historyPath = freshHistory();
  const brain = createApiBrain({ historyPath, keyFn: async () => GEMINI_KEY, fetchFn });
  assert.deepStrictEqual(await brain.ask({ provider: "gemini", text: "hi", system: "s", model: "gemini-3.6-flash" }), { text: "", error: "API key not valid." });
  assert.ok(!fs.existsSync(historyPath));
});

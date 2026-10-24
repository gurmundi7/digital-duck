const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createApiBrain, saveKey, validKey, modelId } = require("../electron/apibrain.cjs");

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
  assert.strictEqual(sent[0].body.model, modelId("haiku"));
  assert.strictEqual(sent[1].body.messages.length, 3);
  for (const f of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, f), "utf8").includes(KEY));
});

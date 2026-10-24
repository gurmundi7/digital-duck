// Chat without the claude CLI: the Anthropic Messages API with a key the owner
// pastes in Settings. The key lives only in the login Keychain.
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");

const SERVICE = "Digital Duck";
const ACCOUNT = "anthropic-api-key";
const KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;
const MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
const MAX_TURNS = 20;

const validKey = (key) => KEY_SHAPE.test(String(key ?? "").trim());
const modelId = (alias) => MODELS[alias] ?? alias;

// The key goes to `security -i` on stdin, so it never shows up in a process
// listing the way an argument would.
function saveKey(key, { spawnFn = spawn } = {}) {
  key = String(key ?? "").trim();
  if (!validKey(key)) return Promise.resolve({ ok: false, error: "That doesn't look like an Anthropic API key (sk-ant-…)." });
  return new Promise((resolve) => {
    const child = spawnFn("security", ["-i"]);
    let err = "";
    child.stderr?.on("data", (d) => { err += d; });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", (code) => resolve(code === 0 && !err ? { ok: true } : { ok: false, error: (err || `exit ${code}`).trim().slice(0, 200) }));
    child.stdin.end(`add-generic-password -U -s "${SERVICE}" -a "${ACCOUNT}" -w "${key}"\n`);
  });
}
function readKey({ execFileFn = execFile } = {}) {
  return new Promise((resolve) => {
    execFileFn("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"], (err, stdout) => resolve(err ? null : String(stdout).trim() || null));
  });
}
function deleteKey({ execFileFn = execFile } = {}) {
  return new Promise((resolve) => execFileFn("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT], () => resolve()));
}

function createApiBrain({ historyPath, fetchFn = fetch, keyFn = readKey }) {
  let history = [];
  try { history = JSON.parse(fs.readFileSync(historyPath, "utf8")); } catch { /* fresh */ }
  const save = () => { try { fs.writeFileSync(historyPath, JSON.stringify(history)); } catch { /* fine */ } };

  async function ask({ text, system, model }) {
    const key = await keyFn();
    if (!key) return { text: "", error: "no brain yet: install Claude Code, or paste an API key under Settings, Brain" };
    const messages = [...history, { role: "user", content: text }];
    let res;
    try {
      res = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: modelId(model), max_tokens: 400, system, messages }),
      });
    } catch (e) { return { text: "", error: `network: ${e.message}`.slice(0, 160) }; }
    const body = await res.json().catch(() => null);
    if (!res.ok) return { text: "", error: (body?.error?.message ?? `HTTP ${res.status}`).slice(0, 160) };
    const reply = (body?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    history = [...messages, { role: "assistant", content: reply || "…" }].slice(-MAX_TURNS * 2);
    save();
    return { text: reply };
  }
  function reset() { history = []; try { fs.unlinkSync(historyPath); } catch { /* fine */ } }
  return { ask, reset };
}

module.exports = { createApiBrain, saveKey, readKey, deleteKey, validKey, modelId };

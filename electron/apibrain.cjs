// Chat without a CLI: the Anthropic, OpenAI or Gemini API with a key the owner pastes
// in Settings. Keys live only in the login Keychain. One neutral history
// ({ role: "user" | "assistant", content }) is shared, so switching provider keeps the thread.
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const { API_PROVIDERS, modelId } = require("./providers.cjs");

const SERVICE = "Digital Duck";
const MAX_TURNS = 20;
// Every key goes through `security -i` inside double quotes, so only this charset is ever let in.
const SAFE_KEY = /^[A-Za-z0-9_.-]{8,300}$/;

const account = (provider) => `${provider}-api-key`;
const clean = (key) => String(key ?? "").trim();
function validKey(key, provider = "anthropic") {
  const k = clean(key);
  return SAFE_KEY.test(k) && (API_PROVIDERS[provider]?.keyShape ?? /^$/).test(k);
}

// The key goes to `security -i` on stdin, so it never shows up in a process
// listing the way an argument would.
function saveKey(key, { provider = "anthropic", spawnFn = spawn } = {}) {
  const k = clean(key);
  const spec = API_PROVIDERS[provider];
  if (!spec) return Promise.resolve({ ok: false, error: "Unknown provider." });
  if (!validKey(k, provider)) return Promise.resolve({ ok: false, error: `That doesn't look like ${spec.keyHint}.` });
  return new Promise((resolve) => {
    const child = spawnFn("security", ["-i"]);
    let err = "";
    child.stderr?.on("data", (d) => { err += d; });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", (code) => resolve(code === 0 && !err ? { ok: true } : { ok: false, error: (err || `exit ${code}`).trim().slice(0, 200) }));
    child.stdin.end(`add-generic-password -U -s "${SERVICE}" -a "${account(provider)}" -w "${k}"\n`);
  });
}
function readKey(provider = "anthropic", { execFileFn = execFile, env = process.env } = {}) {
  const fromEnv = (API_PROVIDERS[provider]?.envKeys ?? []).map((name) => clean(env[name])).find(Boolean);
  return new Promise((resolve) => {
    execFileFn("security", ["find-generic-password", "-s", SERVICE, "-a", account(provider), "-w"], (err, stdout) => resolve((err ? "" : String(stdout).trim()) || fromEnv || null));
  });
}
function deleteKey(provider = "anthropic", { execFileFn = execFile } = {}) {
  return new Promise((resolve) => execFileFn("security", ["delete-generic-password", "-s", SERVICE, "-a", account(provider)], () => resolve()));
}

const OPENAI_URL = "https://api.openai.com/v1";
const trimSlash = (url) => String(url ?? "").replace(/\/+$/, "");

// Each provider turns the shared history into its own request and its reply back into text.
// `lookup` asks for the provider's own server-side web search; it is the only tool an API brain has.
const REQUEST = {
  anthropic: ({ key, model, system, messages, lookup }) => ({
    url: "https://api.anthropic.com/v1/messages",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: {
      model, max_tokens: 400, system, messages,
      ...(lookup ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] } : {}),
    },
    text: (b) => (b?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""),
  }),
  // The official endpoint gets the Responses API (web search, reasoning effort). Any other
  // base URL is an OpenAI-compatible server (Ollama, LM Studio, OpenRouter, Groq, Azure's v1),
  // and those speak Chat Completions.
  openai: ({ key, model, system, messages, lookup, baseUrl }) => {
    const base = trimSlash(baseUrl) || OPENAI_URL;
    const headers = key ? { authorization: `Bearer ${key}` } : {};
    if (base !== OPENAI_URL) {
      return {
        url: `${base}/chat/completions`, headers,
        body: { model, max_tokens: 400, messages: [{ role: "system", content: system }, ...messages] },
        text: (b) => b?.choices?.[0]?.message?.content ?? "",
      };
    }
    return {
      url: `${base}/responses`, headers,
      body: {
        model, instructions: system, input: messages, max_output_tokens: 2000, store: false,
        ...(/^(gpt-([5-9]|\d{2})|o\d)/.test(model) ? { reasoning: { effort: "low" } } : {}),
        ...(lookup ? { tools: [{ type: "web_search" }] } : {}),
      },
      text: (b) => b?.output_text ?? (b?.output ?? []).filter((o) => o.type === "message")
        .flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join(""),
    };
  },
  gemini: ({ key, model, system, messages, lookup }) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: { "x-goog-api-key": key },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 2000 },
      ...(lookup ? { tools: [{ google_search: {} }] } : {}),
    },
    text: (b) => (b?.candidates?.[0]?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join(""),
  }),
};

const errorText = (body, status) => (body?.error?.message ?? body?.[0]?.error?.message ?? body?.message ?? `HTTP ${status}`);

function createApiBrain({ historyPath, fetchFn = fetch, keyFn = readKey }) {
  let history = [];
  try { history = JSON.parse(fs.readFileSync(historyPath, "utf8")); } catch { /* fresh */ }
  const save = () => { try { fs.writeFileSync(historyPath, JSON.stringify(history)); } catch { /* fine */ } };

  async function ask({ provider = "anthropic", text, system, model, lookup = false, baseUrl = "" }) {
    const spec = API_PROVIDERS[provider];
    if (!spec) return { text: "", error: `unknown provider ${provider}` };
    const key = await keyFn(provider);
    // A local OpenAI-compatible server (Ollama, LM Studio) needs no key.
    const keyless = provider === "openai" && trimSlash(baseUrl) && trimSlash(baseUrl) !== OPENAI_URL;
    if (!key && !keyless) return { text: "", error: `no ${spec.label} key yet: paste one under Settings, Brain` };
    const messages = [...history, { role: "user", content: text }];
    const req = REQUEST[provider]({ key, model: modelId(provider, model), system, messages, lookup, baseUrl });
    let res;
    try {
      res = await fetchFn(req.url, { method: "POST", headers: { ...req.headers, "content-type": "application/json" }, body: JSON.stringify(req.body) });
    } catch (e) { return { text: "", error: `network: ${e.message}`.slice(0, 160) }; }
    const body = await res.json().catch(() => null);
    if (!res.ok) return { text: "", error: String(errorText(body, res.status)).slice(0, 160) };
    const reply = String(req.text(body) ?? "").trim();
    history = [...messages, { role: "assistant", content: reply || "…" }].slice(-MAX_TURNS * 2);
    save();
    return { text: reply };
  }
  function reset() { history = []; try { fs.unlinkSync(historyPath); } catch { /* fine */ } }
  return { ask, reset };
}

module.exports = { createApiBrain, saveKey, readKey, deleteKey, validKey };

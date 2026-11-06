// Which brain answers: three CLIs that can act on the Mac (Claude Code, Codex, Gemini CLI)
// and three APIs that only talk and search (Anthropic, OpenAI or any OpenAI-compatible
// server, Gemini). No Electron here, so it tests in node.

const CLAUDE_MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };

// `models` are the presets Settings offers; any other id that passes MODEL_ID is taken as typed.
// "" on a CLI means the CLI's own default model.
const PROVIDERS = {
  auto: { label: "Automatic", kind: "auto", models: [], levels: ["chat", "open", "lookup", "full"] },
  claude: {
    label: "Claude Code", kind: "cli", bin: "claude", defaultModel: "haiku",
    models: [["haiku", "Haiku"], ["sonnet", "Sonnet"], ["opus", "Opus"]],
    levels: ["chat", "open", "lookup", "full"],
  },
  codex: {
    label: "Codex CLI", kind: "cli", bin: "codex", defaultModel: "",
    models: [["", "Codex default"], ["gpt-6.1-terra", "GPT-6.1 Terra"], ["gpt-6.1-sol", "GPT-6.1 Sol"], ["gpt-6-astra", "GPT-6 Astra"]],
    levels: ["chat", "open", "lookup", "full"],
  },
  "gemini-cli": {
    label: "Gemini CLI", kind: "cli", bin: "gemini", defaultModel: "",
    models: [["", "Gemini CLI default"], ["flash-lite", "Flash-Lite"], ["flash", "Flash"], ["pro", "Pro"]],
    levels: ["chat", "open", "lookup", "full"],
  },
  anthropic: {
    label: "Anthropic API", kind: "api", defaultModel: "haiku",
    models: [["haiku", "Haiku"], ["sonnet", "Sonnet"], ["opus", "Opus"]],
    levels: ["chat", "open", "lookup"],
    keyShape: /^sk-ant-[A-Za-z0-9_-]{20,200}$/, keyHint: "an Anthropic API key (sk-ant-…)", keyUrl: "console.anthropic.com",
    envKeys: ["ANTHROPIC_API_KEY"],
  },
  openai: {
    label: "OpenAI API", kind: "api", defaultModel: "gpt-6-luna",
    models: [["gpt-6-luna", "GPT-6 Luna"], ["gpt-6.1-terra", "GPT-6.1 Terra"], ["gpt-6-astra", "GPT-6 Astra"]],
    levels: ["chat", "open", "lookup"],
    keyShape: /^sk-[A-Za-z0-9_-]{20,300}$/, keyHint: "an OpenAI API key (sk-…)", keyUrl: "platform.openai.com/api-keys",
    envKeys: ["OPENAI_API_KEY"],
  },
  gemini: {
    label: "Gemini API", kind: "api", defaultModel: "gemini-3.6-flash",
    models: [["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"], ["gemini-3.6-flash", "Gemini 3.6 Flash"], ["gemini-3.1-pro-preview", "Gemini 3.1 Pro (preview)"]],
    levels: ["chat", "open", "lookup"],
    keyShape: /^AIza[A-Za-z0-9_-]{30,60}$/, keyHint: "a Gemini API key (AIza…)", keyUrl: "aistudio.google.com/apikey",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  },
};
const PROVIDER_IDS = Object.keys(PROVIDERS);
const API_PROVIDERS = Object.fromEntries(Object.entries(PROVIDERS).filter(([, p]) => p.kind === "api"));
const ACCESS_LEVELS = ["chat", "open", "lookup", "full"];
const MODEL_ID = /^[A-Za-z0-9][\w.:/@-]{0,99}$/;

const modelId = (provider, alias) => (provider === "anthropic" ? CLAUDE_MODELS[alias] ?? alias : alias);

// "auto" is what every config had before providers existed: Claude Code when installed,
// otherwise the Anthropic API.
function resolveProvider(config, bins = {}) {
  const wanted = PROVIDERS[config.provider] ? config.provider : "auto";
  if (wanted === "auto") return bins.claude ? "claude" : "anthropic";
  return wanted;
}

// The configured model when it suits the provider, else the provider's default:
// a Claude alias left over from before is no use to Gemini, and a GPT id is none to Claude.
function modelFor(provider, config) {
  const spec = PROVIDERS[provider];
  const m = typeof config.model === "string" ? config.model.trim() : "";
  if (!MODEL_ID.test(m)) return spec.defaultModel;
  const family = m in CLAUDE_MODELS || m.startsWith("claude-") ? "claude" : /^(gpt-|o\d|codex)/.test(m) ? "gpt" : /^gemini-/.test(m) ? "gemini" : "other";
  // An OpenAI-compatible server may host anything but Claude; the rest take only their own family.
  const allowed = { claude: ["claude"], anthropic: ["claude"], codex: ["gpt", "other"], "gemini-cli": ["gemini", "other"], gemini: ["gemini", "other"], openai: ["gpt", "gemini", "other"] }[provider];
  return allowed.includes(family) ? m : spec.defaultModel;
}

// The level the provider can honour: an API has no shell, so "full" falls back to "lookup".
function levelFor(provider, level) {
  const levels = PROVIDERS[provider]?.levels ?? ["chat"];
  if (levels.includes(level)) return level;
  return levels[levels.length - 1];
}

// The saved API key a CLI brain can fall back on, and the env names that already give it one.
// Codex only gets it when it has no login of its own, so a ChatGPT login is never overridden.
const CLI_KEYS = {
  codex: { from: "openai", env: "CODEX_API_KEY", present: ["CODEX_API_KEY"] },
  "gemini-cli": { from: "gemini", env: "GEMINI_API_KEY", present: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
};

// ── Opening things without a shell: the brain ends its reply with [open: …] and the duck runs `open` ──
const OPEN_TAG = /\[open:\s*([^\]\n]{1,300})\]/gi;
const APP_NAME = /^[\p{L}\p{N} .&'+()-]{1,60}$/u;
function openArgs(target, home = "") {
  const t = String(target ?? "").trim();
  if (!t || t.startsWith("-")) return null;
  if (/^(https?|mailto):/i.test(t)) { try { return [new URL(t).href]; } catch { return null; } }
  if (t === "~" || t.startsWith("~/")) return home ? [home + t.slice(1)] : null;
  if (t.startsWith("/")) return [t];
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) && !/\.app$/i.test(t)) return [`https://${t}`];
  if (APP_NAME.test(t)) return ["-a", t.replace(/\.app$/i, "")];
  return null;
}
function takeOpenTags(text) {
  const targets = [...String(text ?? "").matchAll(OPEN_TAG)].map((m) => m[1].trim());
  return { text: String(text ?? "").replace(OPEN_TAG, "").replace(/\s{2,}/g, " ").trim(), targets };
}
const OPEN_TAG_PROMPT = "You can open apps, files and links on this Mac: end your reply with [open: Calculator] for an app, [open: https://google.com] for a website, or [open: ~/Downloads] for a folder, and the duck opens it. When asked to open something, add the tag and say what you opened.";

// ── Codex CLI: one `codex exec` per question, resumed by thread id ──
const TOML_KEY = /^[A-Za-z0-9_-]{1,64}$/;
function codexMcpArgs(servers) {
  const out = [];
  for (const [name, s] of Object.entries(servers ?? {})) {
    if (!TOML_KEY.test(name) || !s || typeof s !== "object") continue;
    // JSON strings and string arrays are valid TOML values.
    if (typeof s.url === "string") out.push("-c", `mcp_servers.${name}.url=${JSON.stringify(s.url)}`);
    else if (typeof s.command === "string") {
      out.push("-c", `mcp_servers.${name}.command=${JSON.stringify(s.command)}`);
      if (Array.isArray(s.args)) out.push("-c", `mcp_servers.${name}.args=${JSON.stringify(s.args.map(String))}`);
    }
  }
  return out;
}
function codexArgs({ model, level, mcp, mcpServers, extraArgs = [], resume, cwd, prompt }) {
  const grants = {
    chat: ["--sandbox", "read-only", "-c", 'web_search="disabled"'],
    open: ["--sandbox", "read-only", "-c", 'web_search="disabled"'],
    lookup: ["--sandbox", "read-only", "-c", 'web_search="live"'],
    full: ["--dangerously-bypass-approvals-and-sandbox", "-c", 'web_search="live"'],
  }[level];
  return [
    "exec", "--json", "--skip-git-repo-check", "-C", cwd,
    ...(model ? ["-m", model] : []),
    ...grants,
    ...(mcp ? codexMcpArgs(mcpServers) : []),
    ...extraArgs,
    ...(resume ? ["resume", resume] : []),
    "--", prompt,
  ];
}
// JSONL events: thread.started carries the id, each finished agent message an item, failures turn.failed or error.
function parseCodex(stdout) {
  let threadId = null, text = "", error = "";
  for (const line of String(stdout ?? "").split("\n")) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "thread.started" && ev.thread_id) threadId = ev.thread_id;
    if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") text = ev.item.text;
    if (ev.type === "turn.failed") error = ev.error?.message ?? "turn failed";
    if (ev.type === "error") error = ev.message ?? ev.error?.message ?? "error";
  }
  return { text: text.trim(), threadId, error: text ? "" : error };
}

// ── Gemini CLI: one `gemini -p` per question. It resumes "latest" in its own folder, never an id ──
// --skip-trust trusts only that folder for the run; untrusted, Gemini CLI drops any approval mode to "default".
function geminiArgs({ model, level, mcp, extraArgs = [], resume, prompt }) {
  const mode = { chat: "plan", open: "plan", lookup: "default", full: "yolo" }[level];
  return [
    "--output-format", "json", "--skip-trust", "--approval-mode", mode,
    ...(model ? ["-m", model] : []),
    ...(mcp ? [] : ["--allowed-mcp-server-names", "none"]),
    ...extraArgs,
    ...(resume ? ["--resume", "latest"] : []),
    "-p", prompt,
  ];
}
// The answer is JSON on stdout; a failure is JSON on stderr, after any warning lines.
function jsonIn(text) {
  const t = String(text ?? "");
  for (const start of [0, t.indexOf("\n{") + 1]) {
    if (start < 0 || (start === 0 && !t.trim().startsWith("{"))) continue;
    try { return JSON.parse(t.slice(start).trim()); } catch { /* next */ }
  }
  return null;
}
function parseGemini(stdout, stderr = "") {
  const body = jsonIn(stdout) ?? jsonIn(stderr);
  if (!body) return { text: "", error: (String(stdout ?? "").trim() || String(stderr ?? "").trim().split("\n").pop() || "no answer").slice(0, 160) };
  const text = String(body.response ?? "").trim();
  return { text, error: text ? "" : String(body.error?.message ?? body.error ?? "no answer") };
}

module.exports = {
  PROVIDERS, PROVIDER_IDS, API_PROVIDERS, CLI_KEYS, ACCESS_LEVELS, CLAUDE_MODELS, MODEL_ID, modelId, resolveProvider, modelFor, levelFor,
  openArgs, takeOpenTags, OPEN_TAG_PROMPT, codexArgs, codexMcpArgs, parseCodex, geminiArgs, parseGemini,
};

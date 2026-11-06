const test = require("node:test");
const assert = require("node:assert");
const { resolveProvider, modelFor, levelFor, openArgs, takeOpenTags, codexArgs, parseCodex, geminiArgs, parseGemini } = require("../electron/providers.cjs");

test("automatic keeps the old behaviour: Claude Code when installed, else the Anthropic API", () => {
  assert.strictEqual(resolveProvider({}, { claude: "/bin/claude" }), "claude");
  assert.strictEqual(resolveProvider({ provider: "auto" }, {}), "anthropic");
  assert.strictEqual(resolveProvider({ provider: "codex" }, { claude: "/bin/claude" }), "codex");
  assert.strictEqual(resolveProvider({ provider: "nonsense" }, {}), "anthropic");
});

test("a model id only reaches a provider that understands it", () => {
  assert.strictEqual(modelFor("claude", { model: "sonnet" }), "sonnet");
  assert.strictEqual(modelFor("gemini", { model: "haiku" }), "gemini-3.6-flash");
  assert.strictEqual(modelFor("claude", { model: "gpt-6-luna" }), "haiku");
  assert.strictEqual(modelFor("openai", { model: "llama3.2:3b" }), "llama3.2:3b");
  assert.strictEqual(modelFor("codex", { model: "" }), "");
  assert.strictEqual(modelFor("gemini-cli", { model: "gpt-6.1-terra" }), "");
  assert.strictEqual(modelFor("codex", { model: "gemini-3.6-flash" }), "");
  assert.strictEqual(modelFor("gemini-cli", { model: "flash" }), "flash");
  assert.strictEqual(modelFor("openai", { model: "gemini-3.6-flash" }), "gemini-3.6-flash");
  assert.strictEqual(modelFor("openai", { model: "" }), "gpt-6-luna");
  assert.strictEqual(modelFor("openai", { model: "$(rm -rf ~)" }), "gpt-6-luna");
});

test("an API cannot do full access, so it falls back to lookup", () => {
  assert.strictEqual(levelFor("openai", "full"), "lookup");
  assert.strictEqual(levelFor("codex", "full"), "full");
  assert.strictEqual(levelFor("gemini", "open"), "open");
});

test("[open: …] tags are taken out of the reply and become safe `open` arguments", () => {
  assert.deepStrictEqual(takeOpenTags("Opening it. [open: Calculator] [sit]"), { text: "Opening it. [sit]", targets: ["Calculator"] });
  assert.deepStrictEqual(openArgs("Calculator"), ["-a", "Calculator"]);
  assert.deepStrictEqual(openArgs("Visual Studio Code.app"), ["-a", "Visual Studio Code"]);
  assert.deepStrictEqual(openArgs("https://google.com"), ["https://google.com/"]);
  assert.deepStrictEqual(openArgs("google.com"), ["https://google.com"]);
  assert.deepStrictEqual(openArgs("~/Downloads", "/Users/me"), ["/Users/me/Downloads"]);
  assert.strictEqual(openArgs("-a Terminal"), null);
  assert.strictEqual(openArgs("Calculator; rm -rf ~"), null);
  assert.strictEqual(openArgs("javascript:alert(1)"), null);
});

test("codex runs read-only with no web search at chat, live search at lookup, and no sandbox only at full", () => {
  const base = { cwd: "/state/codex", prompt: "hi" };
  const chat = codexArgs({ ...base, model: "", level: "chat" });
  assert.deepStrictEqual(chat.slice(0, 5), ["exec", "--json", "--skip-git-repo-check", "-C", "/state/codex"]);
  assert.ok(chat.includes("read-only") && chat.includes('web_search="disabled"'));
  assert.ok(!chat.includes("-m"));
  assert.deepStrictEqual(chat.slice(-2), ["--", "hi"]);
  assert.ok(codexArgs({ ...base, level: "lookup" }).includes('web_search="live"'));
  const full = codexArgs({ ...base, level: "full", model: "gpt-6.1-terra", resume: "t-1" });
  assert.ok(full.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.deepStrictEqual(full.slice(-4), ["resume", "t-1", "--", "hi"]);
  assert.deepStrictEqual(full.slice(5, 7), ["-m", "gpt-6.1-terra"]);
});

test("codex gets the owner's MCP servers as config overrides, and odd names are skipped", () => {
  const args = codexArgs({ cwd: "/c", prompt: "p", level: "chat", mcp: true, mcpServers: { files: { command: "npx", args: ["-y", "server"] }, web: { url: "http://x/mcp" }, "bad name": { command: "x" } } });
  assert.ok(args.includes('mcp_servers.files.command="npx"'));
  assert.ok(args.includes('mcp_servers.files.args=["-y","server"]'));
  assert.ok(args.includes('mcp_servers.web.url="http://x/mcp"'));
  assert.ok(!args.some((a) => a.includes("bad name")));
});

test("the codex event stream gives the thread id and the last agent message", () => {
  const out = [
    '{"type":"thread.started","thread_id":"0199-abc"}',
    '{"type":"item.completed","item":{"id":"i0","type":"reasoning","text":"hmm"}}',
    '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Quack. [sit]"}}',
    '{"type":"turn.completed","usage":{}}',
  ].join("\n");
  assert.deepStrictEqual(parseCodex(out), { text: "Quack. [sit]", threadId: "0199-abc", error: "" });
  assert.deepStrictEqual(parseCodex('{"type":"turn.failed","error":{"message":"rate limited"}}'), { text: "", threadId: null, error: "rate limited" });
});

test("gemini CLI maps levels to approval modes and resumes only its latest session", () => {
  assert.deepStrictEqual(geminiArgs({ level: "chat", prompt: "hi" }), ["--output-format", "json", "--skip-trust", "--approval-mode", "plan", "--allowed-mcp-server-names", "none", "-p", "hi"]);
  const full = geminiArgs({ level: "full", model: "flash", mcp: true, resume: "latest", prompt: "hi" });
  assert.deepStrictEqual(full, ["--output-format", "json", "--skip-trust", "--approval-mode", "yolo", "-m", "flash", "--resume", "latest", "-p", "hi"]);
  assert.deepStrictEqual(parseGemini('{"response":"Quack!","stats":{}}'), { text: "Quack!", error: "" });
  assert.deepStrictEqual(parseGemini('{"error":{"message":"quota"}}'), { text: "", error: "quota" });
  assert.strictEqual(parseGemini("not json").error, "not json");
  // As Gemini CLI 0.67 really fails: nothing on stdout, a warning then the JSON on stderr.
  const stderr = 'Approval mode overridden to "default".\n{\n  "session_id": "5c55",\n  "error": { "type": "Error", "message": "Invalid auth method selected.", "code": 41 }\n}\n';
  assert.deepStrictEqual(parseGemini("", stderr), { text: "", error: "Invalid auth method selected." });
});

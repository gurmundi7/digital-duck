// Codex and Gemini CLI answer one question per process (neither keeps a stdin conversation
// open the way `claude --input-format stream-json` does). Each brain gets its own folder:
// the persona goes in the file that CLI reads from its working folder (AGENTS.md, GEMINI.md),
// and Gemini's "--resume latest" only ever sees the duck's own sessions.
const fs = require("node:fs");
const path = require("node:path");
const { codexArgs, parseCodex, geminiArgs, parseGemini, CLI_KEYS } = require("./providers.cjs");

const CLIS = {
  codex: { dir: "codex", personaFile: "AGENTS.md", args: codexArgs, parse: (out) => { const r = parseCodex(out); return { ...r, sessionId: r.threadId }; } },
  "gemini-cli": { dir: "gemini", personaFile: "GEMINI.md", args: geminiArgs, parse: (out, err) => ({ ...parseGemini(out, err), sessionId: "latest" }) },
};

// The env with the saved API key added, when neither the shell nor the CLI's own login covers it.
// `loggedIn` is only asked for Codex, the one whose login a key would override.
async function withCliKey(provider, env, { readKey, loggedIn }) {
  const need = CLI_KEYS[provider];
  if (!need || need.present.some((name) => env[name])) return env;
  if (provider === "codex" && await loggedIn()) return env;
  const key = await readKey(need.from);
  return key ? { ...env, [need.env]: key } : env;
}

function createCliBrain({ provider, spawn, bin, stateDir, env = () => process.env, timeoutMs = 180000, log = () => {} }) {
  const cli = CLIS[provider];
  const cwd = path.join(stateDir, cli.dir);
  fs.mkdirSync(cwd, { recursive: true });
  let child = null;

  function writeSetup({ persona, mcp, mcpServers }) {
    fs.writeFileSync(path.join(cwd, cli.personaFile), `${persona}\n`);
    // Gemini CLI reads MCP servers from the project's .gemini/settings.json.
    if (provider === "gemini-cli") {
      fs.mkdirSync(path.join(cwd, ".gemini"), { recursive: true });
      fs.writeFileSync(path.join(cwd, ".gemini", "settings.json"), JSON.stringify({ mcpServers: mcp ? mcpServers ?? {} : {} }, null, 2));
    }
  }

  // Resolves { text, error, sessionId }; never rejects.
  function ask({ prompt, persona, model, level, mcp, mcpServers, extraArgs, resume }) {
    if (child) return Promise.resolve({ text: "", error: "busy" });
    writeSetup({ persona, mcp, mcpServers });
    const args = cli.args({ model, level, mcp, mcpServers, extraArgs, resume, cwd, prompt });
    return new Promise((resolve) => {
      let out = "", err = "", done = false;
      const proc = spawn(bin, args, { cwd, env: env() });
      child = proc;
      const finish = (res) => {
        if (done) return;
        done = true; clearTimeout(timer); child = null;
        resolve(res);
      };
      const timer = setTimeout(() => { proc.kill("SIGTERM"); finish({ text: "", error: "timed out" }); }, timeoutMs);
      proc.stdin?.end();
      proc.stdout.on("data", (d) => { out += d; });
      proc.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
      proc.on("error", (e) => finish({ text: "", error: e.message }));
      proc.on("close", (code) => {
        const res = cli.parse(out, err);
        if (!res.text && !res.error) res.error = err.trim().split("\n").pop() || `exit ${code}`;
        if (res.error) log(`[brain] ${provider} exit ${code}: ${(err.trim() || res.error).slice(-300)}`);
        finish(res.text ? { text: res.text, sessionId: res.sessionId } : { text: "", error: String(res.error).slice(0, 160) });
      });
    });
  }

  function stop() { child?.kill("SIGTERM"); child = null; }
  return { ask, stop };
}

module.exports = { createCliBrain, withCliKey };

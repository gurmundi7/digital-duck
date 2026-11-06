// The welcome tour: shown once to a new owner, and from the menu any time after.
// No Electron here, so it tests in node.
const { PROVIDERS } = require("./providers.cjs");

// A new install has no config file yet. An install from before the tour existed has a file
// without `onboarded`; that owner already knows the duck, so the tour is not forced on them.
function tourDue(rawConfig) {
  if (!rawConfig) return true;
  return rawConfig.onboarded === false;
}

const OFFICIAL_OPENAI = /^https:\/\/api\.openai\.com\/v1\/?$/;
const OLLAMA_URL = "http://localhost:11434/v1";
const OLLAMA_MODEL = "llama3.2";

// Whether the brain that would answer can answer, and what it needs if not.
// `bins` maps CLI providers to their path (or null); `hasKey` is the Keychain check for an API.
function brainStatus({ provider, bins = {}, hasKey = false, baseUrl = "" }) {
  const spec = PROVIDERS[provider];
  if (!spec) return { ready: false, label: provider, need: "pick" };
  if (spec.kind === "cli") return bins[provider] ? { ready: true, label: spec.label } : { ready: false, label: spec.label, need: "install" };
  const url = String(baseUrl ?? "").trim();
  if (provider === "openai" && url && !OFFICIAL_OPENAI.test(url)) return { ready: true, label: /localhost:11434/.test(url) ? "Ollama on this Mac" : `${spec.label} at ${url}` };
  return hasKey ? { ready: true, label: spec.label } : { ready: false, label: spec.label, need: "key" };
}

// For someone with nothing set up: pick by what they already have, then follow a short guide.
// Anything already on this Mac (an installed CLI, a saved key) comes first and needs no guide,
// and replaces the guide that would set it up.
const GUIDED = [
  { id: "claude", title: "I pay for Claude", note: "Pro or Max. The free plan can't run Claude Code." },
  { id: "codex", title: "I pay for ChatGPT", note: "Plus or higher. I answer through Codex." },
  { id: "gemini", title: "I have a Google account", note: "A free Gemini key, no card. Google may learn from free chats." },
  { id: "ollama", title: "Nothing yet, keep it free and private", note: "Ollama runs AI on this Mac. 2 GB, a bit slower." },
  { id: "key", title: "I already have an API key", note: "Anthropic, OpenAI or Gemini." },
];
function setupChoices({ bins = {}, keys = {} } = {}) {
  const ready = [
    ...Object.entries(PROVIDERS).filter(([id, p]) => p.kind === "cli" && bins[id]).map(([id, p]) => ({ id: `use:${id}`, title: `Use ${p.label}`, note: "Already on this Mac." })),
    ...Object.entries(PROVIDERS).filter(([id, p]) => p.kind === "api" && keys[id]).map(([id, p]) => ({ id: `use:${id}`, title: `Use ${p.label}`, note: "Key already saved." })),
  ];
  const done = { claude: !!bins.claude, codex: !!bins.codex, gemini: !!keys.gemini };
  return [...ready, ...GUIDED.filter((g) => !done[g.id])];
}

// The steps for one choice. `env` says what this Mac has: brew and npm decide how Codex installs.
// A step has text plus at most one of: a command to copy, a page to open, or keys to paste.
function setupGuide(id, env = {}) {
  if (id.startsWith("use:")) {
    const provider = id.slice(4);
    return { id, title: `Use ${PROVIDERS[provider].label}`, check: { kind: PROVIDERS[provider].kind, provider }, steps: [] };
  }
  switch (id) {
    case "claude": return {
      id, title: "Claude, through Claude Code", check: { kind: "cli", provider: "claude" },
      steps: [
        { text: "Open Terminal and paste this to install Claude Code:", command: "curl -fsSL https://claude.ai/install.sh | bash" },
        { text: "Then run this, and sign in with your Claude account:", command: "claude" },
      ],
    };
    case "codex": {
      const install = env.brew ? "brew install --cask codex" : env.npm ? "npm i -g @openai/codex" : null;
      return {
        id, title: "ChatGPT, through Codex", check: { kind: "cli", provider: "codex" },
        steps: [
          ...(install ? [] : [{ text: "Codex installs with Homebrew. Get Homebrew first:", url: "https://brew.sh" }]),
          { text: "Open Terminal and paste this to install Codex:", command: install ?? "brew install --cask codex" },
          { text: "Then run this, and pick Sign in with ChatGPT:", command: "codex" },
        ],
      };
    }
    case "gemini": return {
      id, title: "A free Gemini key", check: { kind: "api", provider: "gemini" },
      steps: [
        { text: "Open Google AI Studio and sign in with your Google account:", url: `https://${PROVIDERS.gemini.keyUrl}` },
        { text: "Press Create API key, then copy the key." },
        { text: "Paste it here. It stays in your macOS Keychain.", keys: ["gemini"] },
      ],
    };
    case "ollama": return {
      id, title: "Free and private, with Ollama", check: { kind: "ollama", provider: "openai" },
      steps: [
        { text: "Download Ollama, move it to Applications and open it once:", url: "https://ollama.com/download" },
        { text: "Open Terminal and paste this to get a model (about 2 GB):", command: `ollama pull ${OLLAMA_MODEL}` },
      ],
    };
    case "key": return {
      id, title: "Use your API key", check: { kind: "api" },
      steps: [{ text: "Pick whose key it is and paste it. It stays in your macOS Keychain.", keys: ["anthropic", "openai", "gemini"] }],
    };
    default: return null;
  }
}

// The pages the tour may open and the commands it may copy: exactly those in its guides.
const allSteps = () => GUIDED.flatMap((g) => [{ brew: true }, { npm: true }, {}].flatMap((env) => setupGuide(g.id, env).steps));
const tourUrls = () => [...new Set(allSteps().filter((s) => s.url).map((s) => s.url))];
const tourCommands = () => [...new Set(allSteps().filter((s) => s.command).map((s) => s.command))];

// Pick the Ollama model to talk to: the one the guide pulls when it is there, else the first.
function pickOllamaModel(names = []) {
  return names.find((n) => n === OLLAMA_MODEL || n.startsWith(`${OLLAMA_MODEL}:`)) ?? names[0] ?? null;
}

// A brain error, in words someone new can act on.
function explainError(error, { provider, baseUrl = "" } = {}) {
  const spec = PROVIDERS[provider] ?? { label: "That brain", kind: "api" };
  const text = String(error ?? "").trim();
  const local = provider === "openai" && /localhost|127\.0\.0\.1/.test(baseUrl);
  if (/isn't installed|ENOENT|not found/i.test(text)) return `I can't find ${spec.label}. Finish installing it, then press Check again.`;
  if (local && /network|ECONNREFUSED|fetch failed/i.test(text)) return "I can't reach Ollama. Open the Ollama app, then press Check again.";
  if (local && /model.*not found|pull/i.test(text)) return `Ollama has no model yet. Run "ollama pull ${OLLAMA_MODEL}" in Terminal.`;
  if (/quota|billing|credit|insufficient|exceeded|429|rate limit/i.test(text)) return `${spec.label} says the account is out of credit or over its limit. Check billing, or pick another option.`;
  if (/no .* key yet|invalid.*key|incorrect api key|api key not valid|401|403|unauthori[sz]ed|authentication|log ?in|sign ?in|credentials/i.test(text)) {
    return spec.kind === "cli" ? `${spec.label} isn't signed in. Run "${spec.bin}" in Terminal and sign in, then press Check again.` : `${spec.label} refused the key. Copy it again and paste it.`;
  }
  if (/network|ENOTFOUND|ECONNRESET|fetch failed|timed out/i.test(text)) return `I couldn't reach ${spec.label}. Check the internet connection and try again.`;
  return `${spec.label} said: ${text.slice(0, 140) || "nothing"}`;
}

// Things to try: each one is sent to the duck as if typed, so the moves work without a brain
// (the duck reads them from the words) and the rest show what a brain adds.
const TRY_PHRASES = [
  { text: "Sit down", brain: false },
  { text: "Do a roll", brain: false },
  { text: "Put your roller skates on", brain: false },
  { text: "Let's play ball", brain: false },
  { text: "Remind me in 20 minutes to stretch", brain: false },
  { text: "Tell me a duck fact", brain: true },
];
const TEST_QUESTION = "Say hi to me in one short sentence.";

module.exports = { tourDue, brainStatus, setupChoices, setupGuide, tourUrls, tourCommands, pickOllamaModel, explainError, TRY_PHRASES, TEST_QUESTION, OLLAMA_URL };

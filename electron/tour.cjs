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

// Whether the brain that would answer can answer, and what it needs if not.
// `bins` maps CLI providers to their path (or null); `hasKey` is the Keychain check for an API.
function brainStatus({ provider, bins = {}, hasKey = false, baseUrl = "" }) {
  const spec = PROVIDERS[provider];
  if (!spec) return { ready: false, label: provider, need: "pick" };
  if (spec.kind === "cli") return bins[provider] ? { ready: true, label: spec.label } : { ready: false, label: spec.label, need: "install" };
  const url = String(baseUrl ?? "").trim();
  if (provider === "openai" && url && !OFFICIAL_OPENAI.test(url)) return { ready: true, label: `${spec.label} at ${url}` };
  return hasKey ? { ready: true, label: spec.label } : { ready: false, label: spec.label, need: "key" };
}

// What the owner can switch to from the tour: every CLI found on this Mac, then the three APIs.
// `keys` says which APIs already have a key, so those read "Use" rather than "Add a key".
function brainChoices(bins = {}, keys = {}) {
  const clis = Object.entries(PROVIDERS).filter(([id, p]) => p.kind === "cli" && bins[id]).map(([id, p]) => ({ id, label: p.label, kind: "cli" }));
  const apis = Object.entries(PROVIDERS).filter(([, p]) => p.kind === "api").map(([id, p]) => ({ id, label: p.label, kind: "api", keyUrl: p.keyUrl, hasKey: !!keys[id] }));
  return [...clis, ...apis];
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

module.exports = { tourDue, brainStatus, brainChoices, TRY_PHRASES };

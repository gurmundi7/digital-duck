// Defaults a stranger gets on first launch, and the optional private skin pack.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { NUDGE_DEFAULTS } = require("./nudges.cjs");

// Matches build.appId in package.json; electron-builder strips that field from the packaged copy.
const APP_ID = "com.gurpreetmundi.digitalduck";
const APP_NAME = "Digital Duck";

// Everything that reads the calendar, GitHub, the microphone or the network
// beyond chat starts off; the menu turns each one on.
const DEFAULT_CONFIG = {
  voice: "Samantha",
  rate: 190,
  // Spoken voice per skin; skins not listed use voice/rate above. Any name from `say -v '?'`.
  voices: {},
  model: "haiku",
  extraArgs: [],
  // What the brain may run on the Mac: chat, open, lookup or full (see settings.cjs).
  access: "chat",
  listen: false,
  hotkey: "Alt+D",
  typeHotkey: "Alt+T",
  // Global keys for the player in front of Now Playing and the Mac volume; "" turns one off.
  musicKeys: { playPause: "Control+Alt+Space", next: "Control+Alt+Right", previous: "Control+Alt+Left", volumeUp: "Control+Alt+Up", volumeDown: "Control+Alt+Down" },
  quiet: false,
  display: "primary",
  whisperBin: "",
  whisperModel: "",
  nudges: NUDGE_DEFAULTS,
  variant: "classic",
  mcp: false,
  // Extra MCP servers for the brain when mcp is on, same shape as Claude's
  // mcpServers map ({ name: { command, args } } or { name: { url } }).
  mcpServers: {},
  name: os.userInfo().username,
  pet: { greetings: true, wants: true, petting: true },
  work: { reminders: true, briefing: false, briefingTime: "09:15", prWatch: false, endOfDay: false, endOfDayTime: "17:45" },
};

const BASE_VARIANTS = ["classic", "charcoal", "purple", "blue"];

// Skins outside the public repo live in <root>/private/skins.json (main
// process: labels, character, voice) beside private/skins.js (renderer: geometry, sound).
function loadSkinPack(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, "private", "skins.json"), "utf8")); } catch { return {}; }
}

module.exports = { APP_ID, APP_NAME, DEFAULT_CONFIG, BASE_VARIANTS, loadSkinPack };

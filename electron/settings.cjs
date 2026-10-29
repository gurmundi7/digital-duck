// What the Settings window may change, how each value is checked, and what the
// duck is allowed to run at each access level. No Electron here, so it tests in node.

const MODELS = ["haiku", "sonnet", "opus"];
const ACCESS_LEVELS = ["chat", "open", "lookup", "full"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HOTKEY = /^((Command|Cmd|Control|Ctrl|CmdOrCtrl|Alt|Option|Shift|Super)\+)+([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right)$/i;
const MUSIC_KEYS = ["playPause", "next", "previous", "volumeUp", "volumeDown"];
const VOICE = /^[\p{L}\p{N} .()'-]{1,64}$/u;

// Configs from before the levels existed carry openApps; loading fills in the
// default "chat", so that default must not hide it. Picking a level drops openApps.
function accessLevel(config) {
  if (config.openApps && (config.access ?? "chat") === "chat") return "open";
  return ACCESS_LEVELS.includes(config.access) ? config.access : "chat";
}

// `open` launches apps, files and links but cannot change or delete anything.
const OPEN = "Bash(open:*)";
function toolArgs(config) {
  const level = accessLevel(config);
  const granted = {
    chat: [],
    open: ["--allowedTools", OPEN],
    lookup: ["--allowedTools", OPEN, "WebSearch", "WebFetch"],
    full: ["--dangerously-skip-permissions"],
  }[level];
  return [...granted, ...(config.extraArgs ?? [])];
}

// Without being told, small models answer "I can't" instead of trying the tool.
function toolPrompt(config) {
  const open = "You can open apps, files and links on this Mac with the shell command `open`: `open -a Calculator` for an app, `open https://google.com` for a website, `open ~/Downloads` for a folder. When asked to open something, run it, then say what you opened.";
  return {
    chat: "",
    open,
    lookup: `${open} You can also search the web and read web pages to answer questions about news, weather, facts or anything current; look it up instead of guessing.`,
    full: "You have full use of this Mac through the shell: open apps and links, run commands and scripts, control apps with AppleScript (osascript), and search the web. For music in any player (YouTube Music in the browser, Spotify, Music), use `media-control`: `media-control get` says what is playing (null means nothing), and `play`, `pause`, `toggle-play-pause`, `next-track`, `previous-track` control it. When asked to do something on the Mac, do it, then say in one line what you did. Ask first before deleting files, sending messages or spending money.",
  }[accessLevel(config)];
}

const bool = (v) => typeof v === "boolean";

// Checks a form submission against the current config. Valid fields land in the
// returned config; each invalid one gets a message and keeps its old value.
function validateSettings(patch, current) {
  const next = structuredClone(current);
  next.pet = { ...current.pet };
  next.work = { ...current.work };
  next.nudges = { ...current.nudges };
  next.musicKeys = { ...current.musicKeys };
  const errors = {};
  const take = (key, ok, message, set) => {
    if (!(key in patch)) return;
    if (ok(patch[key])) set(patch[key]); else errors[key] = message;
  };
  take("model", (v) => MODELS.includes(v), "Pick Haiku, Sonnet or Opus.", (v) => { next.model = v; });
  take("access", (v) => ACCESS_LEVELS.includes(v), "Pick one of the four levels.", (v) => { next.access = v; delete next.openApps; });
  take("mcp", bool, "On or off.", (v) => { next.mcp = v; });
  take("voice", (v) => typeof v === "string" && VOICE.test(v), "Pick a voice from the list.", (v) => { next.voice = v; });
  take("rate", (v) => Number.isInteger(v) && v >= 90 && v <= 400, "Speed is 90 to 400 words a minute.", (v) => { next.rate = v; });
  take("listen", bool, "On or off.", (v) => { next.listen = v; });
  take("hotkey", (v) => typeof v === "string" && HOTKEY.test(v), "Use a shortcut like Alt+D or Command+Shift+L.", (v) => { next.hotkey = v; });
  take("typeHotkey", (v) => typeof v === "string" && HOTKEY.test(v), "Use a shortcut like Alt+T.", (v) => { next.typeHotkey = v; });
  take("display", (v) => v === "primary" || v === "cursor" || (typeof v === "string" && /^\d+$/.test(v)) || Number.isInteger(v), "Pick a display.", (v) => { next.display = v; });
  take("name", (v) => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 40, "A name of 1 to 40 characters.", (v) => { next.name = v.trim(); });
  for (const k of ["greetings", "wants", "petting"]) take(`pet.${k}`, bool, "On or off.", (v) => { next.pet[k] = v; });
  for (const k of ["reminders", "briefing", "prWatch", "endOfDay"]) take(`work.${k}`, bool, "On or off.", (v) => { next.work[k] = v; });
  for (const k of ["briefingTime", "endOfDayTime"]) take(`work.${k}`, (v) => typeof v === "string" && HHMM.test(v), "Use 24-hour time like 09:15.", (v) => { next.work[k] = v; });
  for (const k of MUSIC_KEYS) take(`musicKeys.${k}`, (v) => v === "" || (typeof v === "string" && HOTKEY.test(v)), "Use a shortcut like Control+Alt+Space, or leave it empty.", (v) => { next.musicKeys[k] = v; });
  for (const k of ["enabled", "calendar"]) take(`nudges.${k}`, bool, "On or off.", (v) => { next.nudges[k] = v; });
  take("nudges.notificationsFile", (v) => typeof v === "string" && v.length <= 1024 && !/[\0\n]/.test(v), "Pick a file.", (v) => { next.nudges.notificationsFile = v.trim(); });
  return { config: next, errors };
}

// The values the window shows, flattened to the same keys validateSettings takes.
function settingsView(config) {
  return {
    model: config.model, access: accessLevel(config), mcp: !!config.mcp,
    voice: config.voice, rate: config.rate, listen: !!config.listen, hotkey: config.hotkey, typeHotkey: config.typeHotkey,
    display: String(config.display), name: config.name ?? "",
    "pet.greetings": config.pet?.greetings !== false, "pet.wants": config.pet?.wants !== false, "pet.petting": config.pet?.petting !== false,
    "work.reminders": config.work?.reminders !== false, "work.briefing": !!config.work?.briefing, "work.prWatch": !!config.work?.prWatch, "work.endOfDay": !!config.work?.endOfDay,
    "work.briefingTime": config.work?.briefingTime ?? "09:15", "work.endOfDayTime": config.work?.endOfDayTime ?? "17:45",
    ...Object.fromEntries(MUSIC_KEYS.map((k) => [`musicKeys.${k}`, config.musicKeys?.[k] ?? ""])),
    "nudges.enabled": !!config.nudges?.enabled, "nudges.calendar": !!config.nudges?.calendar, "nudges.notificationsFile": config.nudges?.notificationsFile ?? "",
  };
}

// `say -v '?'` lines look like "Eddy (English (US))   en_US    # Hello! My name is Eddy."
function parseVoices(text) {
  return String(text).split("\n").map((l) => /^(.*\S)\s+([a-z]{2,3}_[A-Za-z0-9]+)\s+#/.exec(l)).filter(Boolean)
    .map((m) => ({ name: m[1].trim(), lang: m[2] }));
}

module.exports = { MODELS, ACCESS_LEVELS, accessLevel, toolArgs, toolPrompt, validateSettings, settingsView, parseVoices };

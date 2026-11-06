const { app, BrowserWindow, protocol, screen, Tray, Menu, ipcMain, nativeImage, shell, clipboard, globalShortcut, systemPreferences, dialog, powerSaveBlocker } = require("electron");
const { execFileSync, execFile } = require("node:child_process");
const { createNudges, NUDGE_DEFAULTS } = require("./nudges.cjs");
const { spokenCut } = require("./speech.cjs");
const { callReasons } = require("./calls.cjs");
const { createAwake } = require("./awake.cjs");
const { musicFromRequest, createMusic } = require("./music.cjs");
const { createReminders, parseReminder, parseWhen, whenLabel } = require("./reminders.cjs");
const { createPresence } = require("./presence.cjs");
const { createPrWatch } = require("./prwatch.cjs");
const { createWorkday } = require("./workday.cjs");
const { APP_ID, APP_NAME, DEFAULT_CONFIG, BASE_VARIANTS, loadSkinPack } = require("./config.cjs");
const { accessLevel, toolArgs, toolPrompt, validateSettings, settingsView, parseVoices } = require("./settings.cjs");
const { createApiBrain, saveKey, readKey, deleteKey } = require("./apibrain.cjs");
const { PROVIDERS, API_PROVIDERS, CLI_KEYS, resolveProvider, modelFor, levelFor, takeOpenTags, openArgs } = require("./providers.cjs");
const { tourDue, brainStatus, setupChoices, setupGuide, tourUrls, tourCommands, pickOllamaModel, explainError, TRY_PHRASES, TEST_QUESTION, OLLAMA_URL } = require("./tour.cjs");
const { createCliBrain, withCliKey } = require("./clibrain.cjs");
const { attachLogFile } = require("./logfile.cjs");
const { createBrainProcess } = require("./brainproc.cjs");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
// A checkout keeps its state beside the code; the packaged app uses Application Support.
const STATE_DIR = app.isPackaged ? app.getPath("userData") : path.join(ROOT, "state");
fs.mkdirSync(STATE_DIR, { recursive: true });
attachLogFile(path.join(STATE_DIR, "app.log"));
const CONFIG_PATH = path.join(STATE_DIR, "config.json");
const SESSION_PATH = path.join(STATE_DIR, "session.json");
const MEMORY_PATH = path.join(STATE_DIR, "memory.md");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".onnx": "application/octet-stream",
  ".glb": "model/gltf-binary", ".stl": "application/octet-stream", ".xml": "text/xml",
  ".wav": "audio/wav", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png",
  ".map": "application/json",
};

// The duck chats through the brain picked in Settings (providers.cjs): Claude Code, Codex or
// Gemini CLI, or the Anthropic, OpenAI or Gemini API with a Keychain key. What it may run on the
// Mac is the access level (settings.cjs), plus any flags in "extraArgs", which go to that CLI verbatim.
const LAUNCH_AGENT = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_ID}.plist`);

const readJson = (p, fallback) => { try { return { ...fallback, ...JSON.parse(fs.readFileSync(p, "utf8")) }; } catch { return fallback; } };
const config = readJson(CONFIG_PATH, DEFAULT_CONFIG);
const configExisted = fs.existsSync(CONFIG_PATH);
const rawConfig = configExisted ? readJson(CONFIG_PATH, null) : null;
const tourOnLaunch = tourDue(configExisted ? rawConfig ?? {} : null);
if (rawConfig && rawConfig.onboarded === undefined) config.onboarded = true;
if (!config.name || config.name === os.userInfo().username) {
  try {
    const real = execFileSync("dscl", [".", "-read", `/Users/${os.userInfo().username}`, "RealName"], { encoding: "utf8", timeout: 3000 }).replace(/^RealName:\s*/, "").trim().split(/\s+/)[0];
    if (real) config.name = real;
  } catch { /* keep the login name */ }
}
config.pet = { ...DEFAULT_CONFIG.pet, ...(config.pet ?? {}) };
config.work = { ...DEFAULT_CONFIG.work, ...(config.work ?? {}) };
config.musicKeys = { ...DEFAULT_CONFIG.musicKeys, ...(config.musicKeys ?? {}) };
const SKIN_PACK = loadSkinPack(ROOT);
const REMINDERS_PATH = path.join(STATE_DIR, "reminders.json");
const WANTS_PATH = path.join(STATE_DIR, "wants.json");
const MCP_CONFIG_PATH = path.join(STATE_DIR, "mcp.json");
const saveConfig = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
if (!configExisted || (rawConfig && rawConfig.onboarded === undefined)) saveConfig();
config.nudges = { ...NUDGE_DEFAULTS, ...(config.nudges ?? {}) };

// One duck at a time: launchd and a manual start must not both run.
if (!app.requestSingleInstanceLock()) app.quit();

function readMemory() {
  try { return fs.readFileSync(MEMORY_PATH, "utf8").trim(); } catch { return ""; }
}
function rememberLines(lines) {
  const stamp = new Date().toISOString().slice(0, 10);
  const existing = readMemory();
  const add = lines.map((l) => `- ${stamp}: ${l.trim()}`).filter((l) => !existing.includes(l.slice(14)));
  if (!add.length) return;
  fs.writeFileSync(MEMORY_PATH, `${existing}${existing ? "\n" : ""}${add.join("\n")}\n`);
}
const VARIANT_SET = Object.fromEntries([...BASE_VARIANTS, ...Object.keys(SKIN_PACK)].map((v) => [v, 1]));
// A Finder-launched app has a bare PATH, so the usual install folders are tried by hand.
function resolveBin(name, envVar, extra = [], dirs = []) {
  const candidates = [
    process.env[envVar],
    ...extra,
    ...dirs.map((d) => path.join(d, name)),
    path.join(os.homedir(), ".local", "bin", name),
    "/opt/homebrew/bin/" + name, "/usr/local/bin/" + name,
    path.join(os.homedir(), ".npm-global", "bin", name),
    path.join(os.homedir(), ".bun", "bin", name),
    ...(process.env.PATH ?? "").split(":").filter(Boolean).map((d) => path.join(d, name)),
  ].filter(Boolean);
  return candidates.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) ?? null;
}
let CLAUDE_BIN = null;
const CLI_BINS = {};
// Found once at start, and again when the welcome tour checks a CLI someone just installed.
// `dirs` adds the folders of their login shell's PATH (an nvm or custom npm prefix, say).
function findBins(dirs = []) {
  CLAUDE_BIN = resolveBin("claude", "CLAUDE_BIN", [path.join(os.homedir(), ".claude", "local", "claude")], dirs);
  Object.assign(CLI_BINS, { claude: CLAUDE_BIN, codex: resolveBin("codex", "CODEX_BIN", [], dirs), "gemini-cli": resolveBin("gemini", "GEMINI_BIN", [], dirs) });
}
findBins();
function activeProvider() { return resolveProvider(config, { claude: CLAUDE_BIN }); }

const MOVES = `You have a body and these moves: [sit] [stand] [roll] [peck] [quack] [dance] [come] (walk over to the cursor) [hop] (jump onto a window above you) [off] (step off the window you stand on) [skate] (put on roller skates, fast) [walk] (back on legs) [ball] (a beach ball to chase and kick) [noball] [kick] [sleep] [nap] (a short nap) [nap 5s] or [nap 10m] (sleep for exactly that long, then wake up by yourself; use this whenever a length is asked for) [quiet] (quiet mode: no sounds or voice, replies still appear as text) [loud] (sounds back on) [awake] (keep the Mac and its screen awake until told otherwise, what caffeinate does) [awake 120] (for that many minutes) [awake off] (let it sleep again) [color ${Object.keys(VARIANT_SET).join("|")}] [focus N] (a focus block of N minutes: you sit quietly and hold all nudges) [mail] (fetch and deliver the owner's briefing: mail, calendar, tickets) [remind HH:MM text] or [remind +Nm text] (set a reminder; the current date and time are in the context line, so convert 'in 20 minutes' or 'at 3' yourself). Whenever you are asked to do one of them, or it fits the mood, end your reply with that tag, for example: 'Taking a seat. [sit]' or 'Wiggle time! [dance]'. The tag is executed by your body and never spoken; never say you cannot do these.`;
const characterFor = (v) => {
  const skin = SKIN_PACK[v]?.character;
  if (Array.isArray(skin)) return skin.map((l) => l.replaceAll("{name}", config.name));
  return [
    `You are Duck, a 25 cm tall bipedal robot duck who lives on ${config.name}'s Mac desktop as a digital pet.`,
    "You are playful, curious and a little mechanical. Keep replies to at most two short sentences, spoken aloud, so no markdown, lists, links or code blocks. Only two sentences are ever spoken, so when you carry a lot (a briefing, a digest, a list) say the one thing that matters and how many more there are, and leave the rest in the bubble.",
    "Say 'quack' now and then, but not every time.",
  ];
};
const personaFor = (v) => [
  ...characterFor(v),
  MOVES,
  toolPrompt(config, activeProvider()),
  "When you have tools, use them instead of saying you cannot: check the clock, open things, look at the screen, and then report what you did in one line.",
  "You keep a small notebook. When the owner tells you something worth keeping (their name, a routine, a preference, a fact to recall later) or asks you to remember something, end your reply with [remember: one short line]. Notes are kept across conversations.",
  "If you are asked to do something you have no tool for, say so briefly instead of pretending, and mention that the owner can allow more under Settings, What the duck can do.",
].join(" ");
let PERSONA = personaFor(config.variant);

let session = readJson(SESSION_PATH, { id: null, fingerprint: null });
const fingerprint = () => { const p = activeProvider(); return JSON.stringify([p, modelFor(p, config), levelFor(p, accessLevel(config)), toolArgs(config), config.mcp, config.openaiBaseUrl, PERSONA]); };
let brainFingerprint = fingerprint();
// A new persona (skin change) or brain config starts a fresh conversation,
// so the pet does not keep its old name mid chat.
function refreshBrain() {
  PERSONA = personaFor(config.variant);
  brainFingerprint = fingerprint();
  if (session.id && session.fingerprint !== brainFingerprint) {
    session = { id: null, fingerprint: brainFingerprint };
    try { fs.unlinkSync(SESSION_PATH); } catch { /* fine */ }
  }
}
refreshBrain();

protocol.registerSchemesAsPrivileged([{
  scheme: "pet",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true },
}]);

let win = null;
let tray = null;
let sayChild = null;
let muted = !!config.quiet;
// Quiet mode: no chirps and no spoken voice; everything else (walking, nudges,
// replies as text bubbles) carries on. Remembered across launches.
function setQuiet(v) {
  muted = !!v;
  config.quiet = muted; saveConfig();
  send({ type: "mute", value: muted });
  if (muted) stopSaying();
}
let variant = config.variant in VARIANT_SET ? config.variant : "classic";
function setVariant(v) {
  if (v === variant) return;
  variant = v; config.variant = v; saveConfig();
  refreshBrain();
}
let skating = false;


function targetDisplay() {
  const all = screen.getAllDisplays();
  if (config.display === "cursor") return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return all.find((d) => String(d.id) === String(config.display)) ?? screen.getPrimaryDisplay();
}
function stripBounds() {
  const wa = targetDisplay().workArea;
  return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
}
// Moving displays changes the window width, which the renderer bakes into
// its camera and fence at boot, so a move is a reload.
function placeWindow({ reload = false } = {}) {
  if (!win) return;
  const b = stripBounds();
  const cur = win.getBounds();
  if (cur.x === b.x && cur.y === b.y && cur.width === b.width && cur.height === b.height) return;
  win.setBounds(b);
  if (reload) win.webContents.reload();
}
function displayLabel(d) {
  const primary = d.id === screen.getPrimaryDisplay().id;
  return `${d.label || (d.internal ? "Built-in" : "Display")} ${d.size.width}×${d.size.height}${primary ? " (primary)" : ""}`;
}

function createWindow() {
  const wa = stripBounds();
  win = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true, frame: false, hasShadow: false, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, sandbox: false,
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on("console-message", (_e, _level, msg) => console.log("[duck]", msg));
  win.webContents.on("render-process-gone", (_e, d) => console.error("[duck] renderer gone", d));
  win.once("ready-to-show", () => win.show());
  win.loadURL("pet://app/index.html");
  win.webContents.on("did-finish-load", () => setTimeout(() => { sendWindows(); send({ type: "mood", ...mood }); send({ type: "config", name: config.name, variant }); send({ type: "mute", value: muted }); send({ type: "settings", pet: config.pet, work: config.work, wants: readWants() }); }, 1500));
  if (process.env.DUCK_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
}

const send = (cmd) => win?.webContents.send("pet:command", cmd);

function buildMenu() {
  const variants = Object.keys(VARIANT_SET);
  return Menu.buildFromTemplate([
    { label: `Type to the duck (${config.typeHotkey})`, click: () => send({ type: "chat" }) },
    { label: config.listen ? `Listen (${config.hotkey})` : "Listen (turn on Voice input in Settings)", enabled: !!config.listen, click: () => listen() },
    { type: "separator" },
    { label: "Quack", click: () => send({ type: "quack" }) },
    { label: "Sit", click: () => send({ type: "sit" }) },
    { label: "Stand up", click: () => send({ type: "stand" }) },
    { label: "Do a roll", click: () => send({ type: "roll" }) },
    { label: "Peck the ground", click: () => send({ type: "pick" }) },
    { label: "Go to sleep", click: () => send({ type: "sleep" }) },
    { label: "Roller skates", type: "checkbox", checked: skating, click: (item) => { skating = item.checked; send({ type: skating ? "skate" : "walk" }); } },
    { label: "Drop a ball / take it away", click: () => send({ type: "ball" }) },
    { type: "separator" },
    { label: "Colour", submenu: variants.map((v) => ({ label: SKIN_PACK[v]?.label ?? v[0].toUpperCase() + v.slice(1), type: "radio", checked: v === variant, click: () => { setVariant(v); send({ type: "variant", value: v }); } })) },
    { label: "Quiet mode", type: "checkbox", checked: muted, click: (item) => setQuiet(item.checked) },
    { label: awake.active() ? (awake.remainingMin() ? `Awake: ${awake.remainingMin()} min left` : "Awake: until you say otherwise") : "Keep the Mac awake", submenu: [
      { label: "Until I say otherwise", click: () => awake.set(-1, "menu") },
      ...[60, 120, 240].map((m) => ({ label: `${m / 60} hour${m > 60 ? "s" : ""}`, click: () => awake.set(m, "menu") })),
      { type: "separator" },
      { label: "Let it sleep", enabled: awake.active(), click: () => awake.set(0) },
    ] },
    { label: workday?.focusing() ? `Focus: ${workday.focusRemainingMin()} min left` : "Focus", submenu: [
      ...[25, 45, 60, 90].map((m) => ({ label: `${m} minutes`, click: () => workday?.setFocus(m) })),
      { type: "separator" },
      { label: "End focus now", enabled: !!workday?.focusing(), click: () => workday?.setFocus(0) },
    ] },
    { label: reminders?.list().length ? `Reminders (${reminders.list().length})` : "Reminders", submenu: [
      ...(reminders?.list().map((r) => ({ label: `${whenLabel(r.at)}: ${r.text}`, submenu: [{ label: "Cancel this reminder", click: () => reminders.remove(r.id) }] })) ?? []),
      ...(reminders?.list().length ? [{ type: "separator" }] : []),
      { label: "Set one by chat: \"remind me at 3 to…\"", enabled: false },
      { label: "Clear all", enabled: !!reminders?.list().length, click: () => reminders?.clear() },
    ] },
    { label: "Deliver my briefing now", click: () => workday?.briefing({ force: true }) },
    { label: "Settings…", accelerator: "Command+,", click: () => openSettings() },
    { label: "Welcome tour…", click: () => openWelcome() },
    { type: "separator" },
    { label: "Reset duck", click: () => send({ type: "reset" }) },
    { label: "Open notebook…", click: () => { if (!fs.existsSync(MEMORY_PATH)) fs.writeFileSync(MEMORY_PATH, ""); spawn("open", ["-t", MEMORY_PATH]); } },
    { label: "Show config in Finder", click: () => shell.showItemInFolder(CONFIG_PATH) },
    ...(app.isPackaged ? [] : [{ label: "Open DevTools", click: () => win?.webContents.openDevTools({ mode: "detach" }) }]),
    { type: "separator" },
    { label: `Quit ${APP_NAME}`, accelerator: "Command+Q", click: () => app.quit() },
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("🦆");
  tray.setToolTip(APP_NAME);
  tray.on("click", () => tray.popUpContextMenu(buildMenu()));
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));
}

// ── Brain: one chat conversation with whichever brain is picked ─────────
function contextLine(extra = "") {
  const d = new Date();
  const when = d.toLocaleString([], { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const why = callWhy();
  const call = why.length ? ` The owner is on a call right now (seen by ${why.join(" and ")}): your voice is off, so the reply is read as text.` : "";
  return `(Context: it is ${when}.${call}${extra ? ` ${extra}` : ""} Reply as yourself, aloud.)`;
}
function mcpArgs() {
  if (!config.mcp) return ["--setting-sources", "project", "--strict-mcp-config"];
  const servers = config.mcpServers && Object.keys(config.mcpServers).length ? config.mcpServers : null;
  if (!servers) return ["--setting-sources", "project"];
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify({ mcpServers: servers }, null, 2));
  return ["--setting-sources", "project", "--mcp-config", MCP_CONFIG_PATH];
}
const apiBrain = createApiBrain({ historyPath: path.join(STATE_DIR, "history.json") });
const systemPrompt = () => { const memory = readMemory(); return memory ? `${PERSONA}\n\nYour notebook:\n${memory}` : PERSONA; };
async function askBrain(text, opts = {}) {
  const provider = activeProvider();
  const level = levelFor(provider, accessLevel(config));
  let res;
  if (provider === "claude") res = await askClaude(text, opts);
  else if (PROVIDERS[provider].kind === "cli") res = await askCli(provider, text, opts);
  else {
    res = await apiBrain.ask({
      provider, text: `${contextLine(opts.context ?? "")}\n\n${text}`, system: systemPrompt(),
      model: modelFor(provider, config), lookup: level === "lookup", baseUrl: config.openaiBaseUrl,
    });
  }
  if (res.error) return res;
  const notes = [...(res.text ?? "").matchAll(/\[remember:\s*([^\]]+)\]/gi)].map((m) => m[1]);
  if (notes.length) rememberLines(notes);
  const opened = takeOpenTags((res.text ?? "").replace(/\[remember:[^\]]*\]/gi, ""));
  if (level !== "chat") for (const target of opened.targets) openTarget(target);
  return { ...res, text: opened.text };
}
// What a brain without its own shell asked to open: `open` with the target as one argument, no shell.
function openTarget(target) {
  const args = openArgs(target, os.homedir());
  if (!args) return console.error("[open] refused", target.slice(0, 80));
  execFile("open", args, (err) => { if (err) console.error("[open]", target.slice(0, 80), err.message.slice(0, 120)); });
}
// Codex and Gemini CLI: one process per question, resumed from the last one's session.
const cliBrains = {};
const cliEnv = {};
// `codex login status` exits 1 when Codex has neither a ChatGPT login nor a key of its own.
const codexLoggedIn = (bin, env) => new Promise((resolve) => execFile(bin, ["login", "status"], { env, timeout: 10000 }, (err) => resolve(!err)));
async function askCli(provider, text, { retry = true, context = "" } = {}) {
  const bin = CLI_BINS[provider];
  if (!bin) return { text: "", error: `${PROVIDERS[provider].label} isn't installed: pick another brain under Settings, Brain` };
  const env = brainEnv();
  cliEnv[provider] = await withCliKey(provider, env, { readKey, loggedIn: () => codexLoggedIn(bin, env) });
  cliBrains[provider] ??= createCliBrain({ provider, spawn, bin, stateDir: STATE_DIR, env: () => cliEnv[provider], log: (m) => console.info(m) });
  const started = Date.now();
  const res = await cliBrains[provider].ask({
    prompt: `${contextLine(context)}\n\n${text}`, persona: systemPrompt(), model: modelFor(provider, config),
    level: levelFor(provider, accessLevel(config)), mcp: !!config.mcp, mcpServers: config.mcpServers, extraArgs: config.extraArgs ?? [],
    resume: session.id,
  });
  console.info(`[brain] ${provider} answered in ${((Date.now() - started) / 1000).toFixed(1)}s${res.error ? " with an error" : ""}`);
  if (!res.error) {
    if (res.sessionId) { session = { id: res.sessionId, fingerprint: brainFingerprint }; fs.writeFileSync(SESSION_PATH, JSON.stringify(session)); }
    return { text: res.text };
  }
  // A session the CLI no longer has: start a fresh conversation once.
  if (retry && session.id && res.error !== "busy") {
    session = { id: null, fingerprint: brainFingerprint };
    try { fs.unlinkSync(SESSION_PATH); } catch { /* fine */ }
    return askCli(provider, text, { retry: false, context });
  }
  return res;
}
// The brain's arguments without the question; a change here (model, tools, notebook) restarts it.
function brainArgs() {
  return [
    "--model", modelFor("claude", config),
    "--append-system-prompt", systemPrompt(),
    // With mcp on, the account's connectors (Calendar, Gmail, Jira, Slack...) load,
    // plus any servers listed in config.mcpServers.
    ...mcpArgs(),
    "--disable-slash-commands",
    ...toolArgs(config),
  ];
}
let brainProc = null;
const brain = () => (brainProc ??= createBrainProcess({ spawn, bin: CLAUDE_BIN, cwd: STATE_DIR, env: brainEnv, log: (m) => console.info(m) }));
async function askClaude(text, { retry = true, context = "" } = {}) {
  const started = Date.now();
  const res = await brain().ask(`${contextLine(context)}\n\n${text}`, brainArgs(), session.id);
  console.info(`[brain] answered in ${((Date.now() - started) / 1000).toFixed(1)}s${res.is_error ? " with an error" : ""}`);
  if (res.session_id) {
    session = { id: res.session_id, fingerprint: brainFingerprint };
    fs.writeFileSync(SESSION_PATH, JSON.stringify(session));
  }
  if (!res.is_error) return { text: res.result ?? "" };
  const msg = String(res.result ?? "").trim() || "no answer";
  // A stale session id is the usual cause; start a fresh conversation once.
  if (retry && session.id && /session|resume|No conversation/i.test(msg)) {
    session = { id: null, fingerprint: brainFingerprint };
    try { fs.unlinkSync(SESSION_PATH); } catch { /* fine */ }
    return askClaude(text, { retry: false, context });
  }
  console.error("[brain]", msg.slice(0, 500));
  return { text: "", error: msg.slice(0, 160) };
}

function stopSaying() {
  if (sayChild) { sayChild.kill(); sayChild = null; }
  win?.webContents.send("pet:speaking", false);
}
function say(text) {
  return new Promise((resolve) => {
    stopSaying();
    if (muted || !text) return resolve();
    const clean = spokenCut(text);
    if (!clean) return resolve();
    const v = config.voices?.[variant] ?? SKIN_PACK[variant]?.voice ?? {};
    sayChild = spawn("say", ["-v", v.voice ?? config.voice, "-r", String(v.rate ?? config.rate), clean]);
    win?.webContents.send("pet:speaking", true);
    sayChild.on("close", () => { sayChild = null; win?.webContents.send("pet:speaking", false); resolve(); });
    sayChild.on("error", () => { sayChild = null; win?.webContents.send("pet:speaking", false); resolve(); });
  });
}

// ── Window frames: a small Swift helper streams them, the duck walks on their top edges ──
const WINLIST_SRC = path.join(__dirname, "winlist.swift");
const AGENDA_SRC = path.join(__dirname, "agenda.swift");
// The packaged app ships the helpers prebuilt (scripts/build-helpers.sh); a checkout compiles them.
const HELPER_DIR = app.isPackaged ? path.join(process.resourcesPath, "bin") : path.join(STATE_DIR, "bin");
const WINLIST_BIN = path.join(HELPER_DIR, "winlist");
const AGENDA_BIN = path.join(HELPER_DIR, "agenda");
let winlistChild = null;
let lastWindows = [];
// Swift helpers compile on first run and whenever their source is newer.
function ensureHelper(src, bin, cb) {
  if (app.isPackaged) return cb(fs.existsSync(bin));
  const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
  if (mtime(bin) > mtime(src)) return cb(true);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  console.log(`[helpers] compiling ${path.basename(bin)}`);
  execFile("swiftc", ["-O", "-o", bin, src], { timeout: 180000 }, (err, _o, stderr) => {
    if (err) { console.error(`[helpers] ${path.basename(bin)} failed`, (stderr || err.message).slice(0, 400)); return cb(false); }
    cb(true);
  });
}
const ensureWinlist = (cb) => ensureHelper(WINLIST_SRC, WINLIST_BIN, cb);
// On a call when any one signal says so: a call app in front, or another app holding
// the mic (electron/calls.cjs).
const MICWATCH_SRC = path.join(__dirname, "micwatch.swift");
const MICWATCH_BIN = path.join(HELPER_DIR, "micwatch");
let micBusy = false, duckListening = false, micwatchChild = null;
const brainEnv = () => {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const binDirs = [...new Set(Object.values(CLI_BINS).filter(Boolean).map((b) => path.dirname(b)))];
  env.PATH = `${[...binDirs, "/opt/homebrew/bin", "/usr/local/bin"].join(":")}:${env.PATH ?? "/usr/bin:/bin"}`;
  return env;
};
const callWhy = () => callReasons({ frontOwner: lastWindows[0]?.owner, micBusy, duckListening });
const inCall = () => callWhy().length > 0;
function startMicwatch() {
  ensureHelper(MICWATCH_SRC, MICWATCH_BIN, (ok) => {
    if (!ok) return;
    micwatchChild = spawn(MICWATCH_BIN);
    micwatchChild.stdout.on("data", (d) => {
      const last = String(d).trim().split("\n").pop();
      if (last === "1" || last === "0") micBusy = last === "1";
    });
    micwatchChild.on("close", (code) => {
      micwatchChild = null; micBusy = false;
      if (!app.isQuitting) { console.error(`[mic] helper exited ${code}, restarting`); setTimeout(startMicwatch, 2000); }
    });
  });
}
// A spoken exchange keeps the music paused from the moment she listens until her answer is said:
// listening, then heard (the brain is thinking), then replying (the answer is being spoken).
// Nothing recorded or heard, a direct music command, or quiet mode ends it early.
let voice = null, voiceHeard = "", voiceTimer = null;
function endVoice() {
  clearTimeout(voiceTimer);
  voice = null;
  return music.listenEnded(voiceHeard).catch(() => {});
}
ipcMain.on("pet:listening", (_e, on, recorded) => {
  duckListening = Boolean(on);
  if (on) {
    voice = "listening"; voiceHeard = "";
    clearTimeout(voiceTimer);
    voiceTimer = setTimeout(endVoice, 180000);
    music.listenStarted().catch(() => {});
  } else if (!recorded) endVoice();
});
// Mood: what the owner is doing right now, from the window list and the music players.
const VIDEO_APPS = /QuickTime Player|IINA|VLC|^TV$|mpv|Infuse/i;
let mood = { music: false, call: false, video: null };
let musicPlaying = false;
// Now Playing covers every player, browser ones included; without media-control only Music and Spotify.
function pollMusic() {
  if (music.available) { music.nowPlaying().then((info) => { musicPlaying = Boolean(info?.playing); }); return; }
  const script = `
    set out to "stopped"
    try
      if application "Music" is running then
        tell application "Music" to if player state is playing then set out to "playing"
      end if
    end try
    try
      if application "Spotify" is running then
        tell application "Spotify" to if player state is playing then set out to "playing"
      end if
    end try
    return out`;
  execFile("osascript", ["-e", script], { timeout: 8000 }, (err, stdout) => {
    if (err) return;
    musicPlaying = String(stdout).trim() === "playing";
  });
}
function updateMood() {
  const why = callWhy();
  const call = why.length > 0;
  const videoWin = lastWindows.find((w) => VIDEO_APPS.test(w.owner) && w.w >= 400);
  const video = videoWin ? { x: videoWin.x + videoWin.w / 2, y: videoWin.y + videoWin.h / 2, owner: videoWin.owner } : null;
  const next = { music: musicPlaying && !call, call, video };
  if (JSON.stringify(next) !== JSON.stringify(mood)) {
    if (call !== mood.call) (call ? music.callStarted() : music.callEnded()).catch(() => {});
    mood = next;
    console.info(`[mood] ${JSON.stringify(mood)}${call ? ` call by ${why.join("+")}` : ""}`);
    send({ type: "mood", ...mood });
  }
}
setInterval(pollMusic, 15000);
setInterval(updateMood, 3000);

let nudges = null, workday = null, reminders = null, presence = null, prwatch = null;
const pushNudge = (kind, text, opts) => nudges?.push(kind, text, opts);
const music = createMusic({ log: (m) => console.info(m) });
// Keep the Mac awake (caffeinate without caffeinate): menu, chat and voice.
const awake = createAwake({
  powerSaveBlocker,
  onChange: (c) => {
    send({ type: "awake", ...c });
    if (c.reason === "timer") pushNudge("awake", "Awake block done, the Mac can sleep again.", { urgent: true });
  },
});
function startWorkday(agendaBin) {
  reminders = createReminders({
    file: REMINDERS_PATH,
    log: (m) => console.log(m),
    onDue: (r) => pushNudge("reminder", `Reminder: ${r.text}.`, { urgent: true }),
  });
  if (config.work.reminders !== false) reminders.start();
  prwatch = createPrWatch({ log: (m) => console.log(m), onEvent: (e) => pushNudge("pr", e.text, { url: e.url }) });
  if (config.work.prWatch !== false) prwatch.start();
  presence = createPresence({
    log: (m) => console.log(m),
    onEvent: (e) => {
      send({ type: "presence", ...e, greetings: config.pet.greetings !== false });
      if ((e.event === "back" || e.event === "unlock") && nudges) setTimeout(() => nudges.flush(), 4000);
    },
  });
  presence.start();
  workday = createWorkday({
    config, stateDir: STATE_DIR, agendaBin, askBrain, push: pushNudge, prwatch, reminders, presence, send,
    log: (m) => console.log(m),
  });
  workday.start();
}
// A reminder from a brain tag ("15:00 call Sam", "+20m stretch") or the owner's own words.
function setReminderFromSpec(spec) {
  const m = /^\s*(?:\+(\d+)\s*(m|min|minutes?|h|hours?)\b|(\d{1,2}:\d{2})(?:\s*(am|pm))?)\s*(.*)$/i.exec(spec);
  let at = null, text = spec;
  if (m) {
    if (m[1]) { at = Date.now() + Number(m[1]) * (/^h/i.test(m[2]) ? 3600000 : 60000); }
    else { const w = parseWhen(`at ${m[3]}${m[4] ?? ""}`); at = w?.at ?? null; }
    text = m[5].trim() || "the thing you asked about";
  } else {
    const r = parseReminder(spec, new Date(), ["duck", ...Object.keys(SKIN_PACK), ...Object.values(SKIN_PACK).flatMap((k) => k.aliases ?? [])]);
    if (r) { at = r.at; text = r.text; }
  }
  if (!at) return null;
  const r = reminders.add(at, text.replace(/[.!?]+$/, ""));
  return { ...r, label: whenLabel(at) };
}
function startNudges() {
  ensureHelper(AGENDA_SRC, AGENDA_BIN, (ok) => {
    nudges = createNudges({
      settings: config.nudges,
      agendaBin: ok ? AGENDA_BIN : null,
      inCall,
      held: () => !!workday?.focusing(),
      log: (m) => console.log(m),
      onNudge: (n) => { workday?.record(n.kind, n.text); send({ type: "nudge", ...n }); },
    });
    nudges.start();
    startWorkday(ok ? AGENDA_BIN : null);
  });
}
let frontOwner = null;
function noteFront() {
  const f = lastWindows[0];
  if (!f || f.owner === frontOwner) return;
  frontOwner = f.owner;
  if (!win) return;
  const b = win.getBounds();
  send({ type: "front", owner: f.owner, x: f.x - b.x + f.w / 2, y: f.y - b.y + f.h / 2 });
}
function sendWindows() {
  if (!win) return;
  const b = win.getBounds();
  const local = lastWindows.map((w) => ({ ...w, x: w.x - b.x, y: w.y - b.y }));
  win.webContents.send("pet:windows", local);
}
function startWinlist() {
  ensureWinlist((ok) => {
    if (!ok) return;
    winlistChild = spawn(WINLIST_BIN, [String(process.pid)]);
    let buf = "";
    winlistChild.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try { lastWindows = JSON.parse(line); sendWindows(); noteFront(); } catch { /* partial line */ }
      }
    });
    winlistChild.on("close", (code) => {
      winlistChild = null;
      if (!app.isQuitting) { console.error(`[windows] helper exited ${code}, restarting`); setTimeout(startWinlist, 2000); }
    });
  });
}

// ── Start at login: the packaged app uses a login item; a checkout installs a
// per-user launchd agent pointing at itself.
function loginItemOn() {
  return app.isPackaged ? app.getLoginItemSettings().openAtLogin : fs.existsSync(LAUNCH_AGENT);
}
function setLoginItem(on) {
  if (app.isPackaged) { app.setLoginItemSettings({ openAtLogin: on }); return; }
  const uid = process.getuid();
  if (!on) {
    execFile("launchctl", ["bootout", `gui/${uid}/${APP_ID}`], () => {});
    try { fs.unlinkSync(LAUNCH_AGENT); } catch { /* already gone */ }
    return;
  }
  const electronBin = process.execPath;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${APP_ID}</string>
  <key>ProgramArguments</key><array><string>${electronBin}</string><string>${ROOT}</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>StandardOutPath</key><string>${path.join(STATE_DIR, "duck.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(STATE_DIR, "duck.log")}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict></plist>
`;
  fs.mkdirSync(path.dirname(LAUNCH_AGENT), { recursive: true });
  fs.writeFileSync(LAUNCH_AGENT, plist);
  // Register without starting a second copy; RunAtLoad fires at the next login.
  execFile("launchctl", ["bootout", `gui/${uid}/${APP_ID}`], () => {
    execFile("launchctl", ["bootstrap", `gui/${uid}`, LAUNCH_AGENT], (err) => {
      if (err) console.error("[login item]", err.message);
    });
  });
}

// ── API key prompt: a small window; the key goes straight to the Keychain ──
let keyWin = null;
function openKeyPrompt(provider) {
  const spec = API_PROVIDERS[provider] ?? API_PROVIDERS.anthropic;
  if (keyWin) keyWin.close();
  keyWin = new BrowserWindow({
    width: 440, height: 230, resizable: false, minimizable: false, maximizable: false, alwaysOnTop: true, title: `${spec.label} key`,
    webPreferences: { preload: path.join(__dirname, "keyprompt-preload.cjs"), contextIsolation: true, sandbox: true },
  });
  keyWin.setMenu(null);
  keyWin.loadFile(path.join(__dirname, "keyprompt.html"), { query: { provider: API_PROVIDERS[provider] ? provider : "anthropic" } });
  keyWin.on("closed", () => { keyWin = null; welcomeWin?.webContents.send("tour:event", "key-closed"); });
  app.focus({ steal: true });
}
const keyProvider = (p) => (API_PROVIDERS[p] ? p : "anthropic");
ipcMain.handle("key:info", (_e, p) => { const s = API_PROVIDERS[keyProvider(p)]; return { label: s.label, hint: s.keyHint, url: s.keyUrl }; });
ipcMain.handle("key:save", (_e, p, key) => saveKey(key, { provider: keyProvider(p) }));
ipcMain.handle("key:remove", (_e, p) => deleteKey(keyProvider(p)));
ipcMain.handle("key:has", async (_e, p) => !!(await readKey(keyProvider(p))));

// ── Settings window: every change is checked, saved and applied at once ──
let settingsWin = null;
let voiceList = null;
function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560, height: 760, minWidth: 480, minHeight: 400, minimizable: false, maximizable: false, title: `${APP_NAME} Settings`,
    webPreferences: { preload: path.join(__dirname, "settings-preload.cjs"), contextIsolation: true, sandbox: true },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, "settings.html"));
  settingsWin.on("closed", () => { settingsWin = null; });
  app.focus({ steal: true });
}
function voices() {
  if (!voiceList) { try { voiceList = parseVoices(execFileSync("say", ["-v", "?"], { encoding: "utf8", timeout: 5000 })); } catch { voiceList = []; } }
  return voiceList;
}
function applySettings(patch) {
  const { config: next, errors } = validateSettings(patch, config);
  const before = { ...config, work: { ...config.work }, nudges: { ...config.nudges } };
  // In place: nudges, workday and the renderer hold these objects.
  Object.assign(config.pet, next.pet);
  Object.assign(config.work, next.work);
  Object.assign(config.nudges, next.nudges);
  const brainBefore = activeProvider();
  for (const k of ["provider", "model", "openaiBaseUrl", "access", "mcp", "voice", "rate", "listen", "hotkey", "typeHotkey", "display", "name"]) config[k] = next[k];
  const musicKeysBefore = { ...config.musicKeys };
  Object.assign(config.musicKeys, next.musicKeys);
  if (!("openApps" in next)) delete config.openApps;
  saveConfig();
  if (before.hotkey !== config.hotkey || before.listen !== config.listen) { if (before.hotkey) globalShortcut.unregister(before.hotkey); registerListenHotkey(); }
  if (before.typeHotkey !== config.typeHotkey) { if (before.typeHotkey) globalShortcut.unregister(before.typeHotkey); registerTypeHotkey(); }
  if (JSON.stringify(musicKeysBefore) !== JSON.stringify(config.musicKeys)) { for (const key of Object.values(musicKeysBefore)) if (key) globalShortcut.unregister(key); registerMusicKeys(); }
  if (before.nudges.enabled !== config.nudges.enabled) nudges?.setEnabled(config.nudges.enabled);
  if (before.nudges.calendar !== config.nudges.calendar) nudges?.setCalendar(config.nudges.calendar);
  if (before.nudges.notificationsFile !== config.nudges.notificationsFile) nudges?.setNotificationsFile(config.nudges.notificationsFile);
  if (before.work.reminders !== config.work.reminders) { if (config.work.reminders) reminders?.start(); else reminders?.stop(); }
  if (before.work.prWatch !== config.work.prWatch) { if (config.work.prWatch) prwatch?.start(); else prwatch?.stop(); }
  if (String(before.display) !== String(config.display)) placeWindow({ reload: true });
  if (before.name !== config.name) send({ type: "config", name: config.name, variant });
  send({ type: "settings", pet: config.pet, work: config.work });
  if (brainBefore !== activeProvider()) { brainProc?.stop(); for (const b of Object.values(cliBrains)) b.stop(); }
  refreshBrain();
  return { ok: Object.keys(errors).length === 0, errors, values: settingsView(config), active: activeProvider() };
}
ipcMain.handle("settings:load", () => ({
  values: settingsView(config),
  voices: voices(),
  displays: screen.getAllDisplays().map((d) => ({ id: d.id, label: displayLabel(d) })),
  claude: !!CLAUDE_BIN,
  active: activeProvider(),
  providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, kind: p.kind, models: p.models, levels: p.levels, installed: p.kind !== "cli" || !!CLI_BINS[id], keyFrom: CLI_KEYS[id]?.from })),
  login: loginItemOn(),
}));
ipcMain.handle("settings:save", (_e, patch) => applySettings(patch && typeof patch === "object" ? patch : {}));

// ── Welcome tour: opens by itself once for a new owner, and from the menu after ──
let welcomeWin = null;
function openWelcome() {
  if (welcomeWin) { welcomeWin.show(); welcomeWin.focus(); return; }
  const width = 460, height = 560;
  const wa = targetDisplay().workArea;
  welcomeWin = new BrowserWindow({
    width, height, x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) * 0.3),
    resizable: false, minimizable: false, maximizable: false, alwaysOnTop: true, title: `Welcome to ${APP_NAME}`,
    webPreferences: { preload: path.join(__dirname, "welcome-preload.cjs"), contextIsolation: true, sandbox: true },
  });
  welcomeWin.setMenu(null);
  welcomeWin.loadFile(path.join(__dirname, "welcome.html"));
  // Closing it any way counts as seen; it stays in the menu.
  welcomeWin.on("closed", () => {
    welcomeWin = null;
    if (!config.onboarded) { config.onboarded = true; saveConfig(); }
  });
  app.focus({ steal: true });
}
async function tourBrain() {
  const provider = activeProvider();
  const hasKey = API_PROVIDERS[provider] ? !!(await readKey(provider)) : false;
  return brainStatus({ provider, bins: CLI_BINS, hasKey, baseUrl: config.openaiBaseUrl });
}
const TOUR_ACTS = new Set(["dance", "quack", "hop", "come"]);
// The folders on the PATH of the owner's login shell, which a Finder-launched app doesn't get.
let shellDirs = null;
const loginShellDirs = () => (shellDirs ??= new Promise((resolve) => {
  execFile(process.env.SHELL || "/bin/zsh", ["-ilc", "printf '<<%s>>' \"$PATH\""], { timeout: 4000 }, (_err, stdout) => {
    resolve((/<<(.*)>>/.exec(String(stdout ?? ""))?.[1] ?? "").split(":").filter((d) => d.startsWith("/")));
  });
}));
async function rescanBins() {
  const before = { ...CLI_BINS };
  const dirs = await loginShellDirs();
  findBins(dirs);
  for (const [id, bin] of Object.entries(CLI_BINS)) {
    if (bin === before[id]) continue;
    if (id === "claude") { brainProc?.stop(); brainProc = null; }
    else { cliBrains[id]?.stop(); delete cliBrains[id]; }
  }
  return dirs;
}
const savedKeys = async () => Object.fromEntries(await Promise.all(Object.keys(API_PROVIDERS).map(async (id) => [id, !!(await readKey(id))])));
async function setupEnv() {
  const dirs = await loginShellDirs();
  return { brew: !!resolveBin("brew", "BREW_BIN", [], dirs), npm: !!resolveBin("npm", "NPM_BIN", [], dirs) };
}
// Ollama answers on its own port; its list of pulled models says which one to talk to.
async function ollamaModels() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { running: true, models: [] };
    return { running: true, models: ((await res.json()).models ?? []).map((m) => String(m.name)) };
  } catch { return { running: false, models: [] }; }
}
// Whether the choice someone just set up works now, and if it does, make it the brain.
async function checkSetup(id) {
  const guide = setupGuide(String(id), {});
  // Leaving Ollama: its model name means nothing to the next brain.
  const offOllama = config.openaiBaseUrl ? { model: "" } : {};
  if (!guide) return { ok: false, message: "Pick one of the options." };
  const { kind, provider } = guide.check;
  if (kind === "cli") {
    await rescanBins();
    const label = PROVIDERS[provider].label;
    if (!CLI_BINS[provider]) return { ok: false, message: `I can't find ${label} yet. Finish installing it, then press Check again.` };
    applySettings({ provider, ...offOllama });
  } else if (kind === "ollama") {
    const { running, models } = await ollamaModels();
    if (!running) return { ok: false, message: "I can't reach Ollama. Open the Ollama app, then press Check again." };
    const model = pickOllamaModel(models);
    if (!model) return { ok: false, message: "Ollama is running but has no model yet. Paste the pull command in Terminal and wait for it to finish." };
    applySettings({ provider: "openai", openaiBaseUrl: OLLAMA_URL, model });
  } else {
    const keys = await savedKeys();
    const ready = provider ? (keys[provider] ? provider : null) : Object.keys(API_PROVIDERS).find((k) => keys[k]);
    if (!ready) return { ok: false, message: "No key saved yet. Paste one first." };
    applySettings({ provider: ready, ...offOllama, ...(ready === "openai" ? { openaiBaseUrl: "" } : {}) });
  }
  return { ok: true, brain: await tourBrain() };
}
ipcMain.handle("tour:load", async () => {
  loginShellDirs(); // A login shell takes a couple of seconds; start it before a guide needs it.
  return {
    name: config.name,
    brain: await tourBrain(),
    choices: setupChoices({ bins: CLI_BINS, keys: await savedKeys() }),
    phrases: TRY_PHRASES,
    login: loginItemOn(),
    typeHotkey: config.typeHotkey,
    hotkey: config.hotkey,
    listen: !!config.listen,
  };
});
ipcMain.handle("tour:guide", async (_e, id) => setupGuide(String(id), await setupEnv()));
ipcMain.handle("tour:check", (_e, id) => checkSetup(id));
ipcMain.on("tour:key", (_e, provider) => { if (API_PROVIDERS[provider]) openKeyPrompt(provider); });
ipcMain.on("tour:test", () => send({ type: "ask", value: TEST_QUESTION }));
ipcMain.handle("tour:copy", (_e, text) => { if (!tourCommands().includes(text)) return false; clipboard.writeText(text); return true; });
ipcMain.on("tour:open-url", (_e, url) => { if (tourUrls().includes(url)) shell.openExternal(url); });
ipcMain.on("tour:terminal", () => execFile("open", ["-a", "Terminal"], () => {}));
ipcMain.on("tour:act", (_e, name) => { if (TOUR_ACTS.has(name)) send({ type: "act", value: name }); });
ipcMain.on("tour:try", (_e, text) => { if (TRY_PHRASES.some((p) => p.text === text)) send({ type: "ask", value: text }); });
ipcMain.handle("tour:login", (_e, on) => { setLoginItem(!!on); return loginItemOn(); });
ipcMain.on("tour:settings", () => openSettings());
ipcMain.on("tour:done", () => welcomeWin?.close());
ipcMain.on("pet:tour-event", (_e, name, detail) => {
  if (!welcomeWin) return;
  const help = name === "reply-failed" ? explainError(detail, { provider: activeProvider(), baseUrl: config.openaiBaseUrl }) : undefined;
  welcomeWin.webContents.send("tour:event", String(name), help);
});
ipcMain.handle("settings:preview-voice", (_e, voice, rate) => {
  const { errors } = validateSettings({ voice, rate }, config);
  if (Object.keys(errors).length) return;
  spawn("say", ["-v", voice, "-r", String(rate), `Hi ${config.name}, this is how I sound. Quack!`]);
});
ipcMain.handle("settings:pick-file", async () => {
  const r = await dialog.showOpenDialog(settingsWin, { title: "Nudges file", properties: ["openFile", "promptToCreate", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("settings:login", (_e, on) => setLoginItem(!!on));
ipcMain.on("settings:key", (_e, provider) => openKeyPrompt(provider));
ipcMain.on("settings:raw", () => spawn("open", ["-t", CONFIG_PATH]));

// ── Voice in: mic permission, then local whisper.cpp on the renderer's WAV ─
function resolveWhisper() {
  const bins = [config.whisperBin, "/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli", "/opt/homebrew/bin/whisper-cpp"].filter(Boolean);
  const bin = bins.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
  const models = [config.whisperModel, path.join(STATE_DIR, "models", "ggml-base.en.bin"), path.join(STATE_DIR, "models", "ggml-small.en.bin")].filter(Boolean);
  const model = models.find((p) => fs.existsSync(p));
  return { bin, model };
}
function registerTypeHotkey() {
  if (config.typeHotkey && !globalShortcut.register(config.typeHotkey, () => send({ type: "chat" }))) console.error(`[duck] hotkey ${config.typeHotkey} is taken`);
}
// Music keys show the result in the bubble without speaking it.
function registerMusicKeys() {
  for (const [action, key] of Object.entries(config.musicKeys)) {
    if (key && !globalShortcut.register(key, () => music.act(action).then((text) => send({ type: "music", text })))) console.error(`[duck] hotkey ${key} is taken`);
  }
}
function registerListenHotkey() {
  if (config.hotkey) globalShortcut.unregister(config.hotkey);
  if (config.listen && config.hotkey && !globalShortcut.register(config.hotkey, () => listen())) console.error(`[duck] hotkey ${config.hotkey} is taken`);
}
async function listen() {
  if (!config.listen) return;
  const status = systemPreferences.getMediaAccessStatus("microphone");
  const ok = status === "granted" || (await systemPreferences.askForMediaAccess("microphone"));
  if (!ok) { send({ type: "say", value: "I can't hear you: microphone access is off for me in System Settings, Privacy, Microphone." }); return; }
  send({ type: "listen" });
}
function transcribe(wavBuffer) {
  return new Promise((resolve) => {
    const { bin, model } = resolveWhisper();
    if (!bin) return resolve({ text: "", error: "whisper-cli not installed (brew install whisper.cpp)" });
    if (!model) return resolve({ text: "", error: "speech model missing: put ggml-base.en.bin in models/ inside the config folder" });
    const wav = path.join(STATE_DIR, "utterance.wav");
    fs.writeFileSync(wav, Buffer.from(wavBuffer));
    execFile(bin, ["-m", model, "-f", wav, "-l", "en", "-nt", "--no-prints", "-t", "4", "--prompt", "Hey duck, Digital Duck, quack."], { timeout: 30000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(wav); } catch { /* already gone */ }
      if (err) { console.error("[whisper]", (stderr || err.message).slice(0, 300)); return resolve({ text: "", error: "transcription failed" }); }
      const text = String(stdout).split("\n").map((l) => l.trim()).filter(Boolean).join(" ")
        .replace(/\[[^\]]*\]|\([^)]*\)/g, "").replace(/\s+/g, " ").trim(); // drop [BLANK_AUDIO] style tags
      resolve({ text });
    });
  });
}

ipcMain.on("pet:say-stop", () => stopSaying());
ipcMain.on("pet:quiet", (_e, v) => setQuiet(!!v));
ipcMain.on("pet:awake", (_e, minutes) => awake.set(Number(minutes)));
ipcMain.on("pet:variant", (_e, name) => { if (typeof name === "string" && name in VARIANT_SET) setVariant(name); });
ipcMain.handle("pet:transcribe", async (_e, wav) => {
  let res;
  try { res = await transcribe(wav); return res; } finally {
    voiceHeard = String(res?.text ?? "").trim();
    if (voiceHeard && voice === "listening") voice = "heard"; else endVoice();
  }
});
ipcMain.on("pet:set-ignore-mouse", (_e, v) => win?.setIgnoreMouseEvents(!!v, { forward: true }));
ipcMain.on("pet:focus", () => { win?.show(); win?.focus(); });
ipcMain.on("pet:context-menu", () => buildMenu().popup({ window: win }));
ipcMain.on("pet:quit", () => app.quit());
ipcMain.on("pet:log", (_e, msg) => console.log("[duck]", msg));
// One brain call at a time so concurrent asks share the same conversation.
let brainQueue = Promise.resolve();
ipcMain.handle("pet:ask", async (_e, text, context) => {
  const fromVoice = voice === "heard";
  const direct = musicFromRequest(text);
  if (direct) {
    if (fromVoice) await endVoice();
    return { text: await music.act(direct.action, direct.level), direct: true };
  }
  const run = () => askBrain(String(text ?? "").slice(0, 4000), { context: String(context ?? "").slice(0, 400) });
  const p = brainQueue.then(run, run);
  brainQueue = p.catch(() => {});
  if (fromVoice) p.finally(() => { if (voice !== "heard") return; if (muted) endVoice(); else voice = "replying"; }).catch(() => {});
  return p;
});
ipcMain.handle("pet:say", async (_e, text) => {
  await say(String(text ?? ""));
  if (voice === "replying") endVoice();
});
// An announcement over playing music pauses it, says only the short line (the bubble has
// the rest) and plays the music again.
ipcMain.handle("pet:announce", async (_e, text, short) => {
  const resume = muted ? null : await music.hold("announcement");
  await say(String((resume ? short : text) ?? ""));
  await resume?.();
});
ipcMain.handle("pet:remind", (_e, spec) => reminders ? setReminderFromSpec(String(spec ?? "")) : null);
ipcMain.handle("pet:reminders", () => reminders?.list().map((r) => ({ ...r, label: whenLabel(r.at) })) ?? []);
ipcMain.on("pet:focus", (_e, minutes) => workday?.setFocus(Math.max(0, Math.min(180, Number(minutes) || 0))));
ipcMain.on("pet:mail", (_e, context) => workday?.briefing({ force: true, context: String(context ?? "") }));
ipcMain.on("pet:wants", (_e, wants) => { try { fs.writeFileSync(WANTS_PATH, JSON.stringify(wants)); } catch { /* fine */ } });
function readWants() { try { return JSON.parse(fs.readFileSync(WANTS_PATH, "utf8")); } catch { return null; } }

app.whenReady().then(() => {
  protocol.handle("pet", async (req) => {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === "/" || p === "") p = "/index.html";
    const file = path.normalize(path.join(DIST, p));
    if (!file.startsWith(DIST)) return new Response("forbidden", { status: 403 });
    try {
      const buf = await fs.promises.readFile(file);
      return new Response(buf, { headers: { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
  if (app.dock) app.dock.hide();
  createWindow();
  createTray();
  if (tourOnLaunch) win.webContents.once("did-finish-load", () => setTimeout(openWelcome, 2500));
  startWinlist();
  startMicwatch();
  startNudges();
  registerListenHotkey();
  registerTypeHotkey();
  registerMusicKeys();
  if (activeProvider() === "claude" && CLAUDE_BIN) brain().warm(brainArgs(), session.id);
  for (const ev of ["display-added", "display-removed", "display-metrics-changed"]) {
    screen.on(ev, () => setTimeout(() => placeWindow({ reload: true }), 500));
  }
  // Opening the app again while a duck runs: answer on screen, since there is no Dock icon or window to notice.
  app.on("second-instance", () => { win?.show(); send({ type: "quack" }); send({ type: "say", value: "Already here. One duck is plenty." }); });
  console.info(`[duck] brain: ${PROVIDERS[activeProvider()].label}${CLI_BINS[activeProvider()] ? ` at ${CLI_BINS[activeProvider()]}` : ""} (${modelFor(activeProvider(), config) || "default model"}), voice: ${config.voice}, whisper: ${resolveWhisper().bin ?? "missing"} / ${resolveWhisper().model ? "model ok" : "no model"}`);
  console.log(`[duck] displays: ${screen.getAllDisplays().map((d) => `${d.id}=${displayLabel(d)}`).join("; ")}; using ${targetDisplay().id} bounds ${JSON.stringify(win.getBounds())}`);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { app.isQuitting = true; brainProc?.stop(); for (const b of Object.values(cliBrains)) b.stop(); awake.stop("quit"); stopSaying(); globalShortcut.unregisterAll(); winlistChild?.kill(); micwatchChild?.kill(); nudges?.stop(); workday?.stop(); reminders?.stop(); prwatch?.stop(); presence?.stop(); });

// Debug: `kill -USR2 <pid>` writes snap.png to the config folder and logs the duck's state.
process.on("SIGUSR2", async () => {
  if (!win) return;
  try {
    buildMenu(); // throws here if a menu entry is broken
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(STATE_DIR, "snap.png"), img.toPNG());
    const stats = await win.webContents.executeJavaScript(
      "JSON.stringify({ pose: duck.sim.getPose(), mode: duck.sim.mode, state: duck.behaviour.state, sitting: duck.sim.sitting, recovering: duck.sim.recovering, paused: duck.sim.paused, target: duck.behaviour.target, dbg: duck.sim.debug() })",
    );
    console.log("[snap]", stats);
  } catch (e) {
    console.error("[snap] failed", e);
  }
});

// Debug: `kill -USR1 <pid>` runs debug.js from the config folder inside the renderer and logs its result.
// A first line of "// target: settings" or "// target: welcome" runs it in that open window instead.
process.on("SIGUSR1", async () => {
  if (!win) return;
  try {
    const src = fs.readFileSync(path.join(STATE_DIR, "debug.js"), "utf8");
    const target = { settings: settingsWin, welcome: welcomeWin }[/^\/\/ target: (\w+)/.exec(src)?.[1]] ?? win;
    const result = await target.webContents.executeJavaScript(`(async () => { ${src} })()`, true);
    console.log("[debug]", typeof result === "string" ? result : JSON.stringify(result));
  } catch (e) {
    console.error("[debug] failed", e?.message ?? e);
  }
});

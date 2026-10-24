const { app, BrowserWindow, protocol, screen, Tray, Menu, ipcMain, nativeImage, shell, globalShortcut, systemPreferences, dialog } = require("electron");
const { execFileSync, execFile } = require("node:child_process");
const { createNudges, NUDGE_DEFAULTS } = require("./nudges.cjs");
const { createReminders, parseReminder, parseWhen, whenLabel } = require("./reminders.cjs");
const { createPresence } = require("./presence.cjs");
const { createPrWatch } = require("./prwatch.cjs");
const { createWorkday } = require("./workday.cjs");
const { APP_ID, APP_NAME, DEFAULT_CONFIG, BASE_VARIANTS, loadSkinPack } = require("./config.cjs");
const { toolArgs, toolPrompt, validateSettings, settingsView, parseVoices } = require("./settings.cjs");
const { createApiBrain, saveKey, readKey, deleteKey } = require("./apibrain.cjs");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
// A checkout keeps its state beside the code; the packaged app uses Application Support.
const STATE_DIR = app.isPackaged ? app.getPath("userData") : path.join(ROOT, "state");
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

// The duck chats through the owner's own `claude` CLI, or the API key fallback.
// What it may run on the Mac is the access level picked in Settings (settings.cjs),
// plus any flags in "extraArgs", which go to that CLI verbatim.
const LAUNCH_AGENT = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_ID}.plist`);

fs.mkdirSync(STATE_DIR, { recursive: true });
const readJson = (p, fallback) => { try { return { ...fallback, ...JSON.parse(fs.readFileSync(p, "utf8")) }; } catch { return fallback; } };
const config = readJson(CONFIG_PATH, DEFAULT_CONFIG);
if (!config.name || config.name === os.userInfo().username) {
  try {
    const real = execFileSync("dscl", [".", "-read", `/Users/${os.userInfo().username}`, "RealName"], { encoding: "utf8", timeout: 3000 }).replace(/^RealName:\s*/, "").trim().split(/\s+/)[0];
    if (real) config.name = real;
  } catch { /* keep the login name */ }
}
config.pet = { ...DEFAULT_CONFIG.pet, ...(config.pet ?? {}) };
config.work = { ...DEFAULT_CONFIG.work, ...(config.work ?? {}) };
const SKIN_PACK = loadSkinPack(ROOT);
const REMINDERS_PATH = path.join(STATE_DIR, "reminders.json");
const WANTS_PATH = path.join(STATE_DIR, "wants.json");
const MCP_CONFIG_PATH = path.join(STATE_DIR, "mcp.json");
const saveConfig = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
if (!fs.existsSync(CONFIG_PATH)) saveConfig();
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
const MOVES = `You have a body and these moves: [sit] [stand] [roll] [peck] [quack] [dance] [come] (walk over to the cursor) [hop] (jump onto a window above you) [off] (step off the window you stand on) [skate] (put on roller skates, fast) [walk] (back on legs) [ball] (a beach ball to chase and kick) [noball] [kick] [sleep] [nap] (a short nap) [nap 5s] or [nap 10m] (sleep for exactly that long, then wake up by yourself; use this whenever a length is asked for) [quiet] (quiet mode: no sounds or voice, replies still appear as text) [loud] (sounds back on) [color ${Object.keys(VARIANT_SET).join("|")}] [focus N] (a focus block of N minutes: you sit quietly and hold all nudges) [mail] (fetch and deliver the owner's briefing: mail, calendar, tickets) [remind HH:MM text] or [remind +Nm text] (set a reminder; the current date and time are in the context line, so convert 'in 20 minutes' or 'at 3' yourself). Whenever you are asked to do one of them, or it fits the mood, end your reply with that tag, for example: 'Taking a seat. [sit]' or 'Wiggle time! [dance]'. The tag is executed by your body and never spoken; never say you cannot do these.`;
const characterFor = (v) => {
  const skin = SKIN_PACK[v]?.character;
  if (Array.isArray(skin)) return skin.map((l) => l.replaceAll("{name}", config.name));
  return [
    `You are Duck, a 25 cm tall bipedal robot duck who lives on ${config.name}'s Mac desktop as a digital pet.`,
    "You are playful, curious and a little mechanical. Keep replies to one or two short sentences, spoken aloud, so no markdown, lists, links or code blocks.",
    "Say 'quack' now and then, but not every time.",
  ];
};
const personaFor = (v) => [
  ...characterFor(v),
  MOVES,
  toolPrompt(config),
  "When you have tools, use them instead of saying you cannot: check the clock, open things, look at the screen, and then report what you did in one line.",
  "You keep a small notebook. When the owner tells you something worth keeping (their name, a routine, a preference, a fact to recall later) or asks you to remember something, end your reply with [remember: one short line]. Notes are kept across conversations.",
  "If you are asked to do something you have no tool for, say so briefly instead of pretending, and mention that the owner can allow more under Settings, What the duck can do.",
].join(" ");
let PERSONA = personaFor(config.variant);

let session = readJson(SESSION_PATH, { id: null, fingerprint: null });
let brainFingerprint = JSON.stringify([config.model, toolArgs(config), config.mcp, PERSONA]);
// A new persona (skin change) or brain config starts a fresh conversation,
// so the pet does not keep its old name mid chat.
function refreshBrain() {
  PERSONA = personaFor(config.variant);
  brainFingerprint = JSON.stringify([config.model, toolArgs(config), config.mcp, PERSONA]);
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

function resolveClaude() {
  const candidates = [
    process.env.CLAUDE_BIN,
    path.join(os.homedir(), ".local", "bin", "claude"),
    path.join(os.homedir(), ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude", "/usr/local/bin/claude",
    ...(process.env.PATH ?? "").split(":").filter(Boolean).map((d) => path.join(d, "claude")),
  ].filter(Boolean);
  return candidates.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) ?? null;
}
const CLAUDE_BIN = resolveClaude();

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
    { type: "separator" },
    { label: "Reset duck", click: () => send({ type: "reset" }) },
    { label: "Open notebook…", click: () => { if (!fs.existsSync(MEMORY_PATH)) fs.writeFileSync(MEMORY_PATH, ""); spawn("open", ["-t", MEMORY_PATH]); } },
    { label: "Show config in Finder", click: () => shell.showItemInFolder(CONFIG_PATH) },
    { label: "Open DevTools", click: () => win?.webContents.openDevTools({ mode: "detach" }) },
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

// ── Brain: one chat conversation with the owner's claude CLI ────────────
function contextLine(extra = "") {
  const d = new Date();
  const when = d.toLocaleString([], { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return `(Context: it is ${when}.${extra ? ` ${extra}` : ""} Reply as yourself, aloud.)`;
}
function mcpArgs() {
  if (!config.mcp) return ["--setting-sources", "project", "--strict-mcp-config"];
  const servers = config.mcpServers && Object.keys(config.mcpServers).length ? config.mcpServers : null;
  if (!servers) return ["--setting-sources", "project"];
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify({ mcpServers: servers }, null, 2));
  return ["--setting-sources", "project", "--mcp-config", MCP_CONFIG_PATH];
}
const apiBrain = createApiBrain({ historyPath: path.join(STATE_DIR, "history.json") });
function askBrain(text, opts = {}) {
  if (CLAUDE_BIN) return askClaude(text, opts);
  const memory = readMemory();
  return apiBrain.ask({
    text: `${contextLine(opts.context ?? "")}\n\n${text}`,
    system: memory ? `${PERSONA}\n\nYour notebook:\n${memory}` : PERSONA,
    model: config.model,
  }).then((res) => {
    const notes = [...(res.text ?? "").matchAll(/\[remember:\s*([^\]]+)\]/gi)].map((m) => m[1]);
    if (notes.length) rememberLines(notes);
    return { ...res, text: (res.text ?? "").replace(/\[remember:[^\]]*\]/gi, "").trim() };
  });
}
function askClaude(text, { retry = true, context = "" } = {}) {
  return new Promise((resolve) => {
    const memory = readMemory();
    const args = [
      "-p", `${contextLine(context)}\n\n${text}`,
      "--output-format", "json",
      "--model", config.model,
      "--append-system-prompt", memory ? `${PERSONA}\n\nYour notebook:\n${memory}` : PERSONA,
      // With mcp on, the account's connectors (Calendar, Gmail, Jira, Slack...) load,
      // plus any servers listed in config.mcpServers.
      ...mcpArgs(),
      "--disable-slash-commands",
      ...toolArgs(config),
    ];
    if (session.id) args.push("--resume", session.id);
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    env.PATH = `${path.dirname(CLAUDE_BIN)}:/opt/homebrew/bin:/usr/local/bin:${env.PATH ?? "/usr/bin:/bin"}`;
    const child = spawn(CLAUDE_BIN, args, { cwd: STATE_DIR, env });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const killer = setTimeout(() => child.kill("SIGTERM"), 180000);
    child.on("error", (e) => { clearTimeout(killer); resolve({ text: "", error: e.message }); });
    child.on("close", (code) => {
      clearTimeout(killer);
      let parsed = null;
      try { parsed = JSON.parse(out); } catch { /* not json */ }
      if (parsed?.session_id) {
        session = { id: parsed.session_id, fingerprint: brainFingerprint };
        fs.writeFileSync(SESSION_PATH, JSON.stringify(session));
      }
      if (parsed && !parsed.is_error) {
        const result = parsed.result ?? "";
        const notes = [...result.matchAll(/\[remember:\s*([^\]]+)\]/gi)].map((m) => m[1]);
        if (notes.length) rememberLines(notes);
        return resolve({ text: result.replace(/\[remember:[^\]]*\]/gi, "").trim() });
      }
      const msg = (parsed?.result || err || out || `exit ${code}`).trim();
      // A stale session id is the usual cause; start a fresh conversation once.
      if (retry && session.id && /session|resume|No conversation/i.test(msg)) {
        session = { id: null, fingerprint: brainFingerprint };
        try { fs.unlinkSync(SESSION_PATH); } catch { /* fine */ }
        return resolve(askClaude(text, { retry: false, context }));
      }
      console.error("[brain]", msg.slice(0, 500));
      resolve({ text: "", error: msg.slice(0, 160) });
    });
  });
}

function stopSaying() {
  if (sayChild) { sayChild.kill(); sayChild = null; }
  win?.webContents.send("pet:speaking", false);
}
function say(text) {
  return new Promise((resolve) => {
    stopSaying();
    if (muted || !text) return resolve();
    const clean = text.replace(/[*_`#>]/g, "").slice(0, 1200);
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
const CALL_APPS = /zoom\.us|Google Meet|FaceTime|Microsoft Teams|Webex|Around|Tuple/i;
// Only the frontmost window counts: Zoom and Meet keep windows around when no call is on.
const inCall = () => lastWindows.length > 0 && CALL_APPS.test(lastWindows[0].owner);
// Mood: what the owner is doing right now, from the window list and the music players.
const VIDEO_APPS = /QuickTime Player|IINA|VLC|^TV$|mpv|Infuse/i;
let mood = { music: false, call: false, video: null };
let musicPlaying = false;
function pollMusic() {
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
  const call = inCall();
  const videoWin = lastWindows.find((w) => VIDEO_APPS.test(w.owner) && w.w >= 400);
  const video = videoWin ? { x: videoWin.x + videoWin.w / 2, y: videoWin.y + videoWin.h / 2, owner: videoWin.owner } : null;
  const next = { music: musicPlaying && !call, call, video };
  if (JSON.stringify(next) !== JSON.stringify(mood)) {
    mood = next;
    console.log(`[mood] ${JSON.stringify(mood)}`);
    send({ type: "mood", ...mood });
  }
}
setInterval(pollMusic, 15000);
setInterval(updateMood, 3000);

let nudges = null, workday = null, reminders = null, presence = null, prwatch = null;
const pushNudge = (kind, text, opts) => nudges?.push(kind, text, opts);
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
function openKeyPrompt() {
  if (keyWin) { keyWin.show(); keyWin.focus(); return; }
  keyWin = new BrowserWindow({
    width: 440, height: 230, resizable: false, minimizable: false, maximizable: false, alwaysOnTop: true, title: "Anthropic API key",
    webPreferences: { preload: path.join(__dirname, "keyprompt-preload.cjs"), contextIsolation: true, sandbox: true },
  });
  keyWin.setMenu(null);
  keyWin.loadFile(path.join(__dirname, "keyprompt.html"));
  keyWin.on("closed", () => { keyWin = null; });
  app.focus({ steal: true });
}
ipcMain.handle("key:save", async (_e, key) => { const r = await saveKey(key); if (r.ok) apiBrain.reset(); return r; });
ipcMain.handle("key:remove", () => deleteKey());
ipcMain.handle("key:has", async () => !!(await readKey()));

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
  for (const k of ["model", "access", "mcp", "voice", "rate", "listen", "hotkey", "typeHotkey", "display", "name"]) config[k] = next[k];
  if (!("openApps" in next)) delete config.openApps;
  saveConfig();
  if (before.hotkey !== config.hotkey || before.listen !== config.listen) { if (before.hotkey) globalShortcut.unregister(before.hotkey); registerListenHotkey(); }
  if (before.typeHotkey !== config.typeHotkey) { if (before.typeHotkey) globalShortcut.unregister(before.typeHotkey); registerTypeHotkey(); }
  if (before.nudges.enabled !== config.nudges.enabled) nudges?.setEnabled(config.nudges.enabled);
  if (before.nudges.calendar !== config.nudges.calendar) nudges?.setCalendar(config.nudges.calendar);
  if (before.nudges.notificationsFile !== config.nudges.notificationsFile) nudges?.setNotificationsFile(config.nudges.notificationsFile);
  if (before.work.reminders !== config.work.reminders) { if (config.work.reminders) reminders?.start(); else reminders?.stop(); }
  if (before.work.prWatch !== config.work.prWatch) { if (config.work.prWatch) prwatch?.start(); else prwatch?.stop(); }
  if (String(before.display) !== String(config.display)) placeWindow({ reload: true });
  if (before.name !== config.name) send({ type: "config", name: config.name, variant });
  send({ type: "settings", pet: config.pet, work: config.work });
  refreshBrain();
  return { ok: Object.keys(errors).length === 0, errors };
}
ipcMain.handle("settings:load", () => ({
  values: settingsView(config),
  voices: voices(),
  displays: screen.getAllDisplays().map((d) => ({ id: d.id, label: displayLabel(d) })),
  claude: !!CLAUDE_BIN,
  login: loginItemOn(),
}));
ipcMain.handle("settings:save", (_e, patch) => applySettings(patch && typeof patch === "object" ? patch : {}));
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
ipcMain.on("settings:key", () => openKeyPrompt());
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
    if (!model) return resolve({ text: "", error: "speech model missing in state/models" });
    const wav = path.join(STATE_DIR, "utterance.wav");
    fs.writeFileSync(wav, Buffer.from(wavBuffer));
    execFile(bin, ["-m", model, "-f", wav, "-l", "en", "-nt", "--no-prints", "-t", "4", "--prompt", "Hey duck, Microduck, quack."], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) { console.error("[whisper]", (stderr || err.message).slice(0, 300)); return resolve({ text: "", error: "transcription failed" }); }
      const text = String(stdout).split("\n").map((l) => l.trim()).filter(Boolean).join(" ")
        .replace(/\[[^\]]*\]|\([^)]*\)/g, "").replace(/\s+/g, " ").trim(); // drop [BLANK_AUDIO] style tags
      resolve({ text });
    });
  });
}

ipcMain.on("pet:say-stop", () => stopSaying());
ipcMain.on("pet:quiet", (_e, v) => setQuiet(!!v));
ipcMain.on("pet:variant", (_e, name) => { if (typeof name === "string" && name in VARIANT_SET) setVariant(name); });
ipcMain.handle("pet:transcribe", (_e, wav) => transcribe(wav));
ipcMain.on("pet:set-ignore-mouse", (_e, v) => win?.setIgnoreMouseEvents(!!v, { forward: true }));
ipcMain.on("pet:focus", () => { win?.show(); win?.focus(); });
ipcMain.on("pet:context-menu", () => buildMenu().popup({ window: win }));
ipcMain.on("pet:quit", () => app.quit());
ipcMain.on("pet:log", (_e, msg) => console.log("[duck]", msg));
// One brain call at a time so concurrent asks share the same conversation.
let brainQueue = Promise.resolve();
ipcMain.handle("pet:ask", (_e, text, context) => {
  const run = () => askBrain(String(text ?? "").slice(0, 4000), { context: String(context ?? "").slice(0, 400) });
  const p = brainQueue.then(run, run);
  brainQueue = p.catch(() => {});
  return p;
});
ipcMain.handle("pet:say", (_e, text) => say(String(text ?? "")));
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
  startWinlist();
  startNudges();
  registerListenHotkey();
  registerTypeHotkey();
  for (const ev of ["display-added", "display-removed", "display-metrics-changed"]) {
    screen.on(ev, () => setTimeout(() => placeWindow({ reload: true }), 500));
  }
  app.on("second-instance", () => { win?.show(); send({ type: "quack" }); });
  console.log(`[duck] brain: ${CLAUDE_BIN ?? "Anthropic API"} (${config.model}), voice: ${config.voice}, whisper: ${resolveWhisper().bin ?? "missing"} / ${resolveWhisper().model ? "model ok" : "no model"}`);
  console.log(`[duck] displays: ${screen.getAllDisplays().map((d) => `${d.id}=${displayLabel(d)}`).join("; ")}; using ${targetDisplay().id} bounds ${JSON.stringify(win.getBounds())}`);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { app.isQuitting = true; stopSaying(); globalShortcut.unregisterAll(); winlistChild?.kill(); nudges?.stop(); workday?.stop(); reminders?.stop(); prwatch?.stop(); presence?.stop(); });

// Debug: `kill -USR2 <pid>` writes state/snap.png and logs the duck's state.
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

// Debug: `kill -USR1 <pid>` runs state/debug.js inside the renderer and logs its result.
// A first line of "// target: settings" runs it in the open Settings window instead.
process.on("SIGUSR1", async () => {
  if (!win) return;
  try {
    const src = fs.readFileSync(path.join(STATE_DIR, "debug.js"), "utf8");
    const target = /^\/\/ target: settings/.test(src) && settingsWin ? settingsWin : win;
    const result = await target.webContents.executeJavaScript(`(async () => { ${src} })()`, true);
    console.log("[debug]", typeof result === "string" ? result : JSON.stringify(result));
  } catch (e) {
    console.error("[debug] failed", e?.message ?? e);
  }
});

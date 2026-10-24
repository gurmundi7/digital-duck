// Things the duck brings up on its own: meetings about to start, lines another
// tool appends to a JSONL file, and a stretch reminder after a long stretch of
// activity. Quiet hours and video calls hold them back.
const fs = require("node:fs");
const os = require("node:os");
const { execFile } = require("node:child_process");

const DEFAULTS = {
  enabled: false,
  calendar: false,
  leadMin: 5,
  breakEveryMin: 55,
  // A JSONL file to watch, one { "message", "source" } object per line; empty is off.
  notificationsFile: "",
  quietStart: "19:00",
  quietEnd: "08:30",
};

function createNudges({ settings, agendaBin, onNudge, inCall, held = () => false, log = () => {} }) {
  const cfg = { ...DEFAULTS, ...(settings ?? {}) };
  const expand = (p) => (p ? p.replace(/^~(?=\/)/, os.homedir()) : "");
  let NOTIFICATIONS = expand(cfg.notificationsFile);
  const announced = new Map(); // calendar event id -> when
  const pending = [];
  let notifOffset = sizeOf(NOTIFICATIONS);
  let activeSince = null;
  let lastBreakAt = 0;
  let lastAgendaAt = 0;
  let timer = null;

  function sizeOf(p) { try { return fs.statSync(p).size; } catch { return 0; } }
  function hhmm(s) { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); }
  function quiet() {
    const now = new Date(); const t = now.getHours() * 60 + now.getMinutes();
    const a = hhmm(cfg.quietStart), b = hhmm(cfg.quietEnd);
    return a < b ? (t >= a && t < b) : (t >= a || t < b);
  }
  // urgent: something the owner asked for (a reminder), so quiet hours and the
  // master switch do not swallow it; a call or a focus block still holds it.
  function emit(kind, text, { urgent = false, url } = {}) {
    if (!urgent && (!cfg.enabled || quiet())) return;
    if (inCall() || held()) { log(`[nudge] held: ${text}`); pending.push({ kind, text, url }); return; }
    log(`[nudge] ${kind}: ${text}`);
    onNudge({ kind, text, url });
  }
  function flushPending() {
    if (inCall() || held() || !pending.length) return;
    const n = pending.shift();
    onNudge(n);
  }

  function checkCalendar(now) {
    if (!cfg.calendar || !agendaBin || now - lastAgendaAt < 60000) return;
    lastAgendaAt = now;
    execFile(agendaBin, [String(cfg.leadMin + 30)], { timeout: 130000 }, (err, stdout) => {
      if (err) { log(`[nudge] agenda: ${err.message.slice(0, 120)}`); return; }
      let events;
      try { events = JSON.parse(stdout); } catch { return; }
      if (!Array.isArray(events)) { if (events?.error) log(`[nudge] agenda: ${events.error}`); return; }
      for (const e of events) {
        const start = Date.parse(e.start);
        const minutes = Math.round((start - Date.now()) / 60000);
        if (minutes > cfg.leadMin || minutes < -1 || announced.has(e.id)) continue;
        announced.set(e.id, Date.now());
        const when = minutes <= 0 ? "is starting now" : minutes === 1 ? "starts in a minute" : `starts in ${minutes} minutes`;
        const where = e.location && e.location.length < 40 && !/^https?:/.test(e.location) ? `, ${e.location}` : "";
        emit("calendar", `${e.title} ${when}${where}.`);
      }
      for (const [id, at] of announced) if (Date.now() - at > 6 * 3600e3) announced.delete(id);
    });
  }

  function checkNotifications() {
    if (!NOTIFICATIONS) return;
    const size = sizeOf(NOTIFICATIONS);
    if (size < notifOffset) notifOffset = 0; // rotated
    if (size === notifOffset) return;
    const fd = fs.openSync(NOTIFICATIONS, "r");
    const buf = Buffer.alloc(size - notifOffset);
    fs.readSync(fd, buf, 0, buf.length, notifOffset);
    fs.closeSync(fd);
    notifOffset = size;
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const text = String(row.message ?? "")
        .replace(/[*`_>]/g, "").replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2").replace(/https?:\/\/\S+/g, "a link")
        .replace(/\s+/g, " ").trim().slice(0, 220);
      if (text) emit("ticket", `From the ${row.source ?? "watcher"}: ${text}`);
    }
  }

  function checkBreak(now) {
    if (!cfg.breakEveryMin) return;
    execFile("ioreg", ["-c", "IOHIDSystem", "-d", "4"], (err, stdout) => {
      if (err) return;
      const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(stdout);
      if (!m) return;
      const idleS = Number(m[1]) / 1e9;
      if (idleS > 300) { activeSince = null; return; }
      activeSince ??= now;
      const everyMs = cfg.breakEveryMin * 60000;
      if (now - activeSince >= everyMs && now - lastBreakAt >= everyMs) {
        lastBreakAt = now;
        activeSince = now;
        emit("break", `You've been at it for ${cfg.breakEveryMin} minutes. Stretch your legs, I'll hold the fort.`);
      }
    });
  }

  let ticks = 0;
  function tick() {
    const now = Date.now();
    if (ticks++ % 20 === 0) log(`[nudge] tick enabled=${cfg.enabled} quiet=${quiet()} call=${inCall()} notif=${sizeOf(NOTIFICATIONS)}/${notifOffset} pending=${pending.length}`);
    try { checkNotifications(); } catch (e) { log(`[nudge] notifications: ${e.message}`); }
    checkCalendar(now);
    checkBreak(now);
    flushPending();
  }

  return {
    start() { if (!timer) { timer = setInterval(tick, 30000); setTimeout(tick, 5000); } },
    stop() { clearInterval(timer); timer = null; },
    setEnabled(v) { cfg.enabled = !!v; },
    setCalendar(v) { cfg.calendar = !!v; },
    // Starts at the end of the new file: only lines appended from now on are nudges.
    setNotificationsFile(p) { cfg.notificationsFile = p; NOTIFICATIONS = expand(p); notifOffset = sizeOf(NOTIFICATIONS); },
    get enabled() { return cfg.enabled; },
    push: emit,
    flush() { flushPending(); },
    get pendingCount() { return pending.length; },
    tick,
  };
}

module.exports = { createNudges, NUDGE_DEFAULTS: DEFAULTS };

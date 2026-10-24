// Reminders the owner sets by chat or voice ("remind me at 3 to call Sam",
// "in 20 minutes"). Kept in state/reminders.json so they survive restarts.
const fs = require("node:fs");

const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, sixty: 60, half: 0.5, quarter: 0.25 };

// Parses "in 20 minutes", "in an hour and a half", "at 3", "at 15:30", "at 3pm",
// "tomorrow at 9", "tonight at 8", "on monday at 10" into a timestamp, or null.
function parseWhen(text, now = new Date()) {
  const t = text.toLowerCase().replace(/forty[- ]five/g, "fortyfive");
  let m = /\bin\s+(\d+|[a-z]+)\s*(?:and\s+a\s+half\s+)?(min(?:ute)?s?|m\b|h(?:ou)?rs?\b|h\b|hours?|days?)(\s+and\s+a\s+half)?/.exec(t);
  if (m) {
    let n = Number(m[1]); if (Number.isNaN(n)) n = WORD_NUM[m[1]];
    if (n === undefined) return null;
    if (/and\s+a\s+half/.test(m[0])) n += 0.5;
    const unit = m[2][0];
    const ms = unit === "m" ? n * 60000 : unit === "h" ? n * 3600000 : n * 86400000;
    return { at: now.getTime() + ms, consumed: m[0] };
  }
  m = /\b(tomorrow|tonight|this evening|this afternoon|on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(monday|tuesday|wednesday|thursday|friday|saturday|sunday))?\s*(?:at|@|for(?=\s*\d{1,2}(?::\d{2}|\s*[ap]\.?m)))\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/.exec(t);
  if (!m) m = /\b(tomorrow|tonight|this evening|this afternoon)\b()()\s*()()()/.exec(t);
  if (!m) return null;
  const dayWord = m[1] ?? "";
  let hour = m[4] !== undefined && m[4] !== "" ? Number(m[4]) : null;
  const minute = m[5] ? Number(m[5]) : 0;
  const ampm = (m[6] ?? "").replace(/\./g, "");
  const d = new Date(now);
  d.setSeconds(0, 0);
  const dayName = m[2] ?? m[3];
  if (dayName) {
    const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(dayName);
    let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
    d.setDate(d.getDate() + add);
  } else if (/tomorrow/.test(dayWord)) d.setDate(d.getDate() + 1);
  if (hour === null) {
    if (/tonight|evening/.test(dayWord)) hour = 20; else if (/afternoon/.test(dayWord)) hour = 15; else if (/tomorrow/.test(dayWord)) hour = 9; else return null;
  }
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (!ampm && hour <= 7 && !/tomorrow|tonight|evening|afternoon/.test(dayWord) && !dayName) hour += 12; // "at 3" means 15:00 at work
  if (/tonight|evening/.test(dayWord) && hour < 12) hour += 12;
  d.setHours(hour, minute);
  if (!dayName && !/tomorrow/.test(dayWord) && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return { at: d.getTime(), consumed: m[0] };
}

// "remind me at 3 to call Sam" -> { at, text: "call Sam" }
function parseReminder(request, now = new Date(), petNames = ["duck"]) {
  if (!/\bremind\b|\breminder\b/i.test(request)) return null;
  const when = parseWhen(request, now);
  if (!when) return null;
  let text = request.replace(when.consumed, " ")
    .replace(new RegExp(`\\b(please|can you|could you|would you|hey|${petNames.map((n) => n.replace(/\W/g, "")).join("|")})\\b`, "gi"), " ")
    .replace(/\bremind\s+me\b/i, " ").replace(/\bset\s+a\s+reminder\b/i, " ").replace(/\breminder\b/i, " ")
    .replace(/^\s*(to|that|about|for)\b/i, " ").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  text = text.replace(/^\s*(to|that|about|for)\s+/i, "");
  if (!text) text = "the thing you asked about";
  return { at: when.at, text };
}

function createReminders({ file, onDue, log = () => {} }) {
  let items = [];
  try { items = JSON.parse(fs.readFileSync(file, "utf8")); } catch { items = []; }
  if (!Array.isArray(items)) items = [];
  const save = () => fs.writeFileSync(file, JSON.stringify(items, null, 2));
  let timer = null;
  function tick() {
    const now = Date.now();
    const due = items.filter((r) => r.at <= now);
    if (!due.length) return;
    items = items.filter((r) => r.at > now);
    save();
    for (const r of due) { log(`[remind] due: ${r.text}`); onDue(r); }
  }
  return {
    add(at, text) {
      const r = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, text, setAt: Date.now() };
      items.push(r); items.sort((a, b) => a.at - b.at); save();
      log(`[remind] set ${new Date(at).toLocaleString()}: ${text}`);
      return r;
    },
    remove(id) { items = items.filter((r) => r.id !== id); save(); },
    clear() { items = []; save(); },
    list() { return items.slice(); },
    start() { if (!timer) timer = setInterval(tick, 15000); },
    stop() { clearInterval(timer); timer = null; },
  };
}

function whenLabel(at) {
  const d = new Date(at), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return time;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString([], { weekday: "long" })} at ${time}`;
}

module.exports = { createReminders, parseReminder, parseWhen, whenLabel };

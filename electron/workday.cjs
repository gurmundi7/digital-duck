// The owner's working day, as the pet sees it: a morning briefing, focus
// blocks, an end-of-day recap, and a log of what it delivered. Reminders and
// pull-request news arrive through the same nudge queue.
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { whenLabel } = require("./reminders.cjs");

const BRIEFING_PROMPT = [
  "Give me my morning briefing in your own voice, in at most four short spoken sentences, no lists.",
  "Use your tools: unread email from real people since yesterday evening (skip newsletters and notifications), today's calendar with the first meeting's time,",
  "and issues or pull requests assigned to me or waiting on me. Mention counts and the one or two that matter most.",
  "If a tool is not available, say so in five words and move on. End with one dry line.",
].join(" ");

function createWorkday({ config, stateDir, agendaBin, askBrain, push, prwatch, reminders, presence, send, log = () => {} }) {
  const LOG = path.join(stateDir, "daylog.json");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  let day = { date: today(), briefedOn: null, eodOn: null, events: [] };
  try { const d = JSON.parse(fs.readFileSync(LOG, "utf8")); if (d.date === today()) day = { ...day, ...d }; } catch { /* fresh day */ }
  const save = () => fs.writeFileSync(LOG, JSON.stringify(day, null, 2));
  function rollDay() { if (day.date !== today()) { day = { date: today(), briefedOn: null, eodOn: null, events: [] }; save(); } }
  function record(kind, text) { rollDay(); day.events.push({ t: Date.now(), kind, text: String(text).slice(0, 160) }); if (day.events.length > 200) day.events.shift(); save(); }

  // Focus: the pet sits quietly, nudges queue up, a chime at the end.
  let focusUntil = 0, focusTimer = null, focusMin = 0;
  function setFocus(minutes) {
    clearTimeout(focusTimer);
    if (!minutes) {
      if (focusUntil) { focusUntil = 0; send({ type: "focus", minutes: 0 }); push("focus", `Focus block done. ${focusMin} minutes, well held.`, { urgent: true }); record("focus", `${focusMin} min focus done`); }
      return;
    }
    focusMin = minutes; focusUntil = Date.now() + minutes * 60000;
    send({ type: "focus", minutes });
    record("focus", `${minutes} min focus started`);
    focusTimer = setTimeout(() => setFocus(0), minutes * 60000);
  }
  const focusing = () => focusUntil > Date.now();

  function hhmm(s) { const [h, m] = String(s ?? "").split(":").map(Number); return (h || 0) * 60 + (m || 0); }
  const minutesNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const weekday = () => { const d = new Date().getDay(); return d >= 1 && d <= 5; };

  function todaysEvents(cb) {
    if (!agendaBin || !config.nudges?.calendar) return cb([]);
    const d = new Date(); const untilMidnight = Math.max(1, Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) - d) / 60000));
    execFile(agendaBin, [String(untilMidnight)], { timeout: 130000 }, (err, stdout) => {
      if (err) return cb([]);
      try { const ev = JSON.parse(stdout); cb(Array.isArray(ev) ? ev : []); } catch { cb([]); }
    });
  }
  function localBriefing(cb) {
    todaysEvents((events) => {
      const parts = [];
      if (events.length) {
        const first = events[0];
        const at = new Date(first.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        parts.push(`${events.length === 1 ? "One meeting" : `${events.length} meetings`} today, the first is ${first.title} at ${at}.`);
      } else parts.push("No meetings on the calendar today.");
      const prs = prwatch?.summary() ?? [];
      if (prs.length) {
        const red = prs.filter((p) => p.checks === "red").length;
        const approved = prs.filter((p) => p.review === "APPROVED").length;
        parts.push(`${prs.length} open pull request${prs.length === 1 ? "" : "s"}${red ? `, ${red} with red checks` : ""}${approved ? `, ${approved} approved and ready to land` : ""}.`);
      }
      const due = reminders.list().filter((r) => new Date(r.at).toDateString() === new Date().toDateString());
      if (due.length) parts.push(`${due.length === 1 ? "One reminder" : `${due.length} reminders`} set for today, the next at ${whenLabel(due[0].at)}.`);
      cb(parts.join(" "));
    });
  }
  async function briefing({ force = false, context = "" } = {}) {
    rollDay();
    if (!force && day.briefedOn) return;
    day.briefedOn = Date.now(); save();
    let text;
    if (config.mcp) {
      const res = await askBrain(BRIEFING_PROMPT, { context, speaker: "briefing" });
      text = res?.text?.trim();
      if (!text) log(`[briefing] brain: ${res?.error ?? "empty"}`);
    }
    if (!text) text = await new Promise((r) => localBriefing(r));
    push("mail", text, { urgent: force });
    record("briefing", text);
  }
  function endOfDay({ force = false } = {}) {
    rollDay();
    if (!force && day.eodOn) return;
    day.eodOn = Date.now(); save();
    const count = (k) => day.events.filter((e) => e.kind === k).length;
    const bits = [];
    const rem = count("reminder"); if (rem) bits.push(`${rem} reminder${rem === 1 ? "" : "s"} delivered`);
    const prs = count("pr"); if (prs) bits.push(`${prs} pull request update${prs === 1 ? "" : "s"}`);
    const cal = count("calendar"); if (cal) bits.push(`${cal} meeting${cal === 1 ? "" : "s"} announced`);
    const foc = day.events.filter((e) => e.kind === "focus" && /done/.test(e.text)).length; if (foc) bits.push(`${foc} focus block${foc === 1 ? "" : "s"}`);
    const left = reminders.list().filter((r) => r.at > Date.now() && new Date(r.at).toDateString() === new Date().toDateString());
    const text = `That's the day. ${bits.length ? bits.join(", ") + "." : "A quiet one on my side."}${left.length ? ` Still ${left.length === 1 ? "one reminder" : `${left.length} reminders`} coming this evening.` : ""} Go stretch.`;
    push("eod", text);
    record("eod", text);
  }

  let timer = null;
  function tick() {
    rollDay();
    const w = config.work ?? {};
    if (presence.away) return;
    if (w.briefing !== false && weekday() && !day.briefedOn && minutesNow() >= hhmm(w.briefingTime ?? "09:15") && minutesNow() < hhmm(w.briefingTime ?? "09:15") + 180) briefing();
    if (w.endOfDay !== false && weekday() && !day.eodOn && minutesNow() >= hhmm(w.endOfDayTime ?? "17:45") && minutesNow() < hhmm(w.endOfDayTime ?? "17:45") + 120) endOfDay();
  }
  return {
    start() { if (!timer) { timer = setInterval(tick, 30000); setTimeout(tick, 20000); } },
    stop() { clearInterval(timer); clearTimeout(focusTimer); timer = null; },
    record, briefing, endOfDay, setFocus, focusing,
    focusRemainingMin: () => (focusing() ? Math.ceil((focusUntil - Date.now()) / 60000) : 0),
    get today() { return day; },
  };
}

module.exports = { createWorkday };

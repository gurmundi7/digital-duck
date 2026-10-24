// Timed naps: "[nap 5s]" from the brain, or "sleep for 5 seconds" in the owner's words.

const UNIT_MS = { s: 1000, m: 60000, h: 3600000 };
const MAX_MS = 12 * 3600000;

// "5s", "10m", "1h", or a bare number of minutes; null when there is no usable length.
export function napMs(arg) {
  const m = /^(\d{1,4})\s*([smh])?$/i.exec(String(arg ?? "").trim());
  if (!m) return null;
  const ms = Number(m[1]) * UNIT_MS[(m[2] ?? "m").toLowerCase()];
  return ms > 0 && ms <= MAX_MS ? ms : null;
}

// "5 seconds", "10 minutes", "2 hours": whole units only, so 90 minutes stays minutes.
export function napText(ms) {
  const unit = ms % UNIT_MS.h === 0 ? "hour" : ms % UNIT_MS.m === 0 ? "minute" : "second";
  const n = ms / UNIT_MS[unit[0]];
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function napFromRequest(request) {
  if (!/\b(sleep|nap|wake)\b/i.test(request) || /\bwake me\b/i.test(request)) return null;
  const m = /\b(\d{1,4})\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\b/i.exec(request);
  return m ? `nap ${m[1]}${m[2][0].toLowerCase()}` : null;
}

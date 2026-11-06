const test = require("node:test");
const assert = require("node:assert");
const { createNudges } = require("../electron/nudges.cjs");

// Quiet hours set to a window that starts two hours from now.
const h = new Date().getHours();
const hh = (x) => `${String(x % 24).padStart(2, "0")}:00`;
const base = { agendaBin: null, inCall: () => false, settings: { breakEveryMin: 0, quietStart: hh(h + 2), quietEnd: hh(h + 3) } };

test("nudges are off until turned on", () => {
  const seen = [];
  const n = createNudges({ ...base, onNudge: (x) => seen.push(x) });
  n.push("break", "stretch");
  assert.strictEqual(n.enabled, false);
  assert.deepStrictEqual(seen, []);
});

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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

test("lines appended to the configured notifications file become nudges", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "duck-")), "n.jsonl");
  fs.writeFileSync(file, "");
  const seen = [];
  const n = createNudges({ ...base, settings: { ...base.settings, enabled: true, notificationsFile: file }, onNudge: (x) => seen.push(x) });
  fs.appendFileSync(file, JSON.stringify({ message: "CI failed", source: "ci" }) + "\n");
  n.tick();
  assert.deepStrictEqual(seen.map((s) => s.text), ["From the ci: CI failed"]);
});

test("a notifications file picked in Settings is read without a restart", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "duck-")), "n.jsonl");
  fs.writeFileSync(file, JSON.stringify({ message: "old line", source: "ci" }) + "\n");
  const seen = [];
  const n = createNudges({ ...base, settings: { ...base.settings, enabled: true }, onNudge: (x) => seen.push(x) });
  n.setNotificationsFile(file);
  fs.appendFileSync(file, JSON.stringify({ message: "deploy done", source: "ci" }) + "\n");
  n.tick();
  assert.deepStrictEqual(seen.map((s) => s.text), ["From the ci: deploy done"]);
});

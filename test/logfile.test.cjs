const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { attachLogFile } = require("../electron/logfile.cjs");

const quiet = () => ({ log() {}, info() {}, warn() {}, error() {} });

test("console lines go to the file with a timestamp", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duck-log-"));
  const file = path.join(dir, "app.log");
  const target = quiet();
  attachLogFile(file, { target, now: () => new Date(2026, 9, 28, 13, 5, 9) });
  target.info("[mood] %s", "call");
  target.error(new Error("boom").message);
  assert.deepStrictEqual(fs.readFileSync(file, "utf8").trim().split("\n"), ["2026-10-28 13:05:09 [mood] call", "2026-10-28 13:05:09 boom"]);
});

test("a full file moves aside and one older file is kept", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duck-log-"));
  const file = path.join(dir, "app.log");
  const target = quiet();
  attachLogFile(file, { target, maxBytes: 60 });
  for (const n of [1, 2, 3, 4]) target.info(`line number ${n} with some words`);
  assert.match(fs.readFileSync(file, "utf8"), /line number 4/);
  assert.match(fs.readFileSync(`${file}.1`, "utf8"), /line number 3/);
  assert.ok(!fs.existsSync(`${file}.2`));
});

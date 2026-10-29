const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { APP_ID, APP_NAME, DEFAULT_CONFIG, loadSkinPack } = require("../electron/config.cjs");

test("the app id the code uses is the one the build signs", () => {
  assert.strictEqual(APP_ID, require("../package.json").build.appId);
});

test("Microduck stays out of every name the app shows", () => {
  const pkg = require("../package.json");
  const shown = [APP_NAME, pkg.productName, pkg.build.productName, pkg.build.dmg.title, ...Object.values(pkg.build.mac.extendInfo).filter((v) => typeof v === "string")];
  for (const name of shown) assert.doesNotMatch(name, /microduck/i);
  assert.strictEqual(APP_NAME, "Digital Duck");
  assert.strictEqual(pkg.build.productName, APP_NAME);
});

test("the README opens with the unofficial line", () => {
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  const header = readme.slice(0, readme.indexOf("\n## "));
  assert.match(header, /<h1 align="center">Digital Duck<\/h1>/);
  assert.match(header, /An unofficial desktop pet inspired by Pollen's Microduck\. Not affiliated with or endorsed by Pollen Robotics or Hugging Face\./);
});

test("a stranger's first launch has every outside-reading feature off", () => {
  assert.strictEqual(DEFAULT_CONFIG.listen, false);
  assert.strictEqual(DEFAULT_CONFIG.work.prWatch, false);
  assert.strictEqual(DEFAULT_CONFIG.work.briefing, false);
  assert.strictEqual(DEFAULT_CONFIG.nudges.enabled, false);
  assert.strictEqual(DEFAULT_CONFIG.nudges.calendar, false);
  assert.strictEqual(DEFAULT_CONFIG.nudges.notificationsFile, "");
  assert.deepStrictEqual(DEFAULT_CONFIG.extraArgs, []);
});

test("no private folder means no extra skins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duck-"));
  assert.deepStrictEqual(loadSkinPack(dir), {});
});

test("a private skins.json is picked up", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duck-"));
  fs.mkdirSync(path.join(dir, "private"));
  fs.writeFileSync(path.join(dir, "private", "skins.json"), JSON.stringify({ goose: { label: "Goose" } }));
  assert.deepStrictEqual(loadSkinPack(dir), { goose: { label: "Goose" } });
});


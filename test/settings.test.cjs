const test = require("node:test");
const assert = require("node:assert");
const { DEFAULT_CONFIG } = require("../electron/config.cjs");
const { NUDGE_DEFAULTS } = require("../electron/nudges.cjs");
const { accessLevel, toolArgs, toolPrompt, validateSettings, settingsView, parseVoices } = require("../electron/settings.cjs");

const base = () => ({ ...structuredClone(DEFAULT_CONFIG), nudges: { ...NUDGE_DEFAULTS } });

test("a stranger's duck starts chat only: it can run nothing on the Mac", () => {
  assert.strictEqual(accessLevel(DEFAULT_CONFIG), "chat");
  assert.deepStrictEqual(toolArgs(DEFAULT_CONFIG), []);
  assert.strictEqual(toolPrompt(DEFAULT_CONFIG), "");
});

test("each access level grants exactly its tools", () => {
  assert.deepStrictEqual(toolArgs({ access: "open" }), ["--allowedTools", "Bash(open:*)"]);
  assert.deepStrictEqual(toolArgs({ access: "lookup" }), ["--allowedTools", "Bash(open:*)", "WebSearch", "WebFetch"]);
  assert.deepStrictEqual(toolArgs({ access: "full" }), ["--dangerously-skip-permissions"]);
});

test("the owner's own extraArgs still follow the level", () => {
  assert.deepStrictEqual(toolArgs({ access: "open", extraArgs: ["--verbose"] }), ["--allowedTools", "Bash(open:*)", "--verbose"]);
});

test("an old config with openApps keeps opening apps", () => {
  assert.strictEqual(accessLevel({ ...DEFAULT_CONFIG, openApps: true }), "open"); // as loaded: defaults fill access
  assert.strictEqual(accessLevel({ openApps: true, access: "full" }), "full");
});

test("each level tells the duck what it can do, so it tries instead of refusing", () => {
  assert.match(toolPrompt({ access: "open" }), /open -a .*open https:\/\//);
  assert.match(toolPrompt({ access: "lookup" }), /search the web/);
  assert.match(toolPrompt({ access: "full" }), /osascript/);
  assert.match(toolPrompt({ access: "full" }), /media-control next-track|`next-track`/);
});

test("valid settings land in the config", () => {
  const { config, errors } = validateSettings({ model: "opus", access: "full", rate: 220, "work.briefingTime": "08:30", "pet.petting": false }, base());
  assert.deepStrictEqual(errors, {});
  assert.strictEqual(config.model, "opus");
  assert.strictEqual(config.access, "full");
  assert.strictEqual(config.rate, 220);
  assert.strictEqual(config.work.briefingTime, "08:30");
  assert.strictEqual(config.pet.petting, false);
});

test("bad values are refused with a message and keep the old value", () => {
  const current = base();
  const { config, errors } = validateSettings({ model: "gpt; rm -rf ~", "work.briefingTime": "25:00", rate: 9000, hotkey: "D", access: "root" }, current);
  assert.deepStrictEqual(Object.keys(errors).sort(), ["access", "hotkey", "model", "rate", "work.briefingTime"]);
  assert.strictEqual(config.model, current.model);
  assert.strictEqual(config.work.briefingTime, current.work.briefingTime);
  assert.strictEqual(config.access, current.access);
});

test("unknown settings keys are dropped, not saved", () => {
  const { config, errors } = validateSettings({ bogus: "value" }, base());
  assert.deepStrictEqual(errors, {});
  assert.ok(!("bogus" in config));
  assert.ok(!("bogus" in settingsView(base())));
});

test("saving does not touch the config it was given", () => {
  const current = base();
  validateSettings({ "pet.wants": false, "nudges.enabled": true }, current);
  assert.strictEqual(current.pet.wants, true);
  assert.strictEqual(current.nudges.enabled, false);
});

test("choosing a level drops the old openApps flag", () => {
  const { config } = validateSettings({ access: "chat" }, { ...base(), openApps: true });
  assert.strictEqual(accessLevel(config), "chat");
});

test("the window shows what validateSettings takes back", () => {
  const view = settingsView(base());
  const { errors } = validateSettings(view, base());
  assert.deepStrictEqual(errors, {});
});

test("voices come out of say -v '?' with spaces and brackets intact", () => {
  const out = "Samantha            en_US    # Hello! My name is Samantha.\nEddy (English (US)) en_US    # Hi\nReed (English (UK))  en_GB    # Hello! My name is Reed.\n";
  assert.deepStrictEqual(parseVoices(out).map((v) => v.name), ["Samantha", "Eddy (English (US))", "Reed (English (UK))"]);
});

test("music keys take arrows, and an empty key turns one off", () => {
  const { config, errors } = validateSettings({ "musicKeys.next": "Control+Alt+Right", "musicKeys.previous": "", "musicKeys.volumeUp": "Banana" }, DEFAULT_CONFIG);
  assert.strictEqual(config.musicKeys.next, "Control+Alt+Right");
  assert.strictEqual(config.musicKeys.previous, "");
  assert.strictEqual(config.musicKeys.volumeUp, DEFAULT_CONFIG.musicKeys.volumeUp);
  assert.ok(errors["musicKeys.volumeUp"]);
  assert.strictEqual(settingsView(config)["musicKeys.next"], "Control+Alt+Right");
});

test("picking a provider brings its default model, unless a model comes with it", () => {
  const { config, errors } = validateSettings({ provider: "gemini" }, base());
  assert.deepStrictEqual(errors, {});
  assert.strictEqual(config.provider, "gemini");
  assert.strictEqual(config.model, "gemini-3.6-flash");
  assert.strictEqual(validateSettings({ provider: "codex" }, base()).config.model, "");
  assert.strictEqual(validateSettings({ provider: "openai", model: "gpt-6.1-terra" }, base()).config.model, "gpt-6.1-terra");
  assert.deepStrictEqual(Object.keys(validateSettings({ provider: "skynet" }, base()).errors), ["provider"]);
});

test("the OpenAI base URL is empty or an http(s) URL", () => {
  assert.strictEqual(validateSettings({ openaiBaseUrl: " http://localhost:11434/v1 " }, base()).config.openaiBaseUrl, "http://localhost:11434/v1");
  assert.deepStrictEqual(Object.keys(validateSettings({ openaiBaseUrl: "file:///etc/passwd" }, base()).errors), ["openaiBaseUrl"]);
});

test("a brain without Claude Code's own `open` is told to use the [open: …] tag", () => {
  assert.match(toolPrompt({ access: "open" }, "codex"), /\[open: Calculator\]/);
  assert.match(toolPrompt({ access: "open" }, "claude"), /`open -a Calculator`/);
  // An API cannot do "full"; it gets the lookup prompt instead of one promising a shell.
  assert.doesNotMatch(toolPrompt({ access: "full" }, "gemini"), /osascript/);
  assert.match(toolPrompt({ access: "full" }, "gemini"), /search the web/);
});

test("settings show the provider and an old config as automatic", () => {
  assert.strictEqual(settingsView({ ...base(), provider: undefined }).provider, "auto");
  assert.strictEqual(settingsView({ ...base(), provider: "openai" }).provider, "openai");
});

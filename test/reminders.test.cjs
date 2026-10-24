const test = require("node:test");
const assert = require("node:assert");
const { parseReminder } = require("../electron/reminders.cjs");

test("the pet's own names are dropped from the reminder text", () => {
  const now = new Date(2026, 9, 23, 10, 0);
  assert.strictEqual(parseReminder("hey duck remind me in 20 minutes to stretch", now).text, "stretch");
  assert.strictEqual(parseReminder("goose remind me in 20 minutes to stretch", now, ["duck", "goose"]).text, "stretch");
});

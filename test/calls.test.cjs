const test = require("node:test");
const assert = require("node:assert");
const { callReasons } = require("../electron/calls.cjs");

test("either signal is enough, and each is named", () => {
  assert.deepStrictEqual(callReasons({ frontOwner: "Google Meet" }), ["screen"]);
  assert.deepStrictEqual(callReasons({ frontOwner: "Ghostty", micBusy: true }), ["mic"]);
  assert.deepStrictEqual(callReasons({ frontOwner: "zoom.us", micBusy: true }), ["screen", "mic"]);
  assert.deepStrictEqual(callReasons({ frontOwner: "Ghostty" }), []);
});

test("the duck's own push-to-talk is not a call", () => {
  assert.deepStrictEqual(callReasons({ frontOwner: "Ghostty", micBusy: true, duckListening: true }), []);
});

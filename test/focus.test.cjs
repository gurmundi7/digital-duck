const test = require("node:test");
const assert = require("node:assert");
const { createFocus } = require("../electron/focus.cjs");

function focusWith() {
  const sent = [], pushed = [];
  const focus = createFocus({ send: (cmd) => sent.push(cmd), push: (kind, text) => pushed.push({ kind, text }) });
  return { focus, sent, pushed };
}

test("a focus block holds until it is ended, then says it is done", () => {
  const { focus, sent, pushed } = focusWith();
  focus.setFocus(45);
  assert.strictEqual(focus.focusing(), true);
  assert.strictEqual(focus.remainingMin(), 45);
  focus.setFocus(0);
  assert.strictEqual(focus.focusing(), false);
  assert.deepStrictEqual(sent, [{ type: "focus", minutes: 45 }, { type: "focus", minutes: 0 }]);
  assert.deepStrictEqual(pushed, [{ kind: "focus", text: "Focus block done. 45 minutes, well held." }]);
  focus.stop();
});

test("ending focus when none is running says nothing", () => {
  const { focus, sent, pushed } = focusWith();
  focus.setFocus(0);
  assert.deepStrictEqual(sent, []);
  assert.deepStrictEqual(pushed, []);
});

test("a focus block ends by itself when its time is up", async () => {
  const { focus, pushed } = focusWith();
  focus.setFocus(0.001); // 60 ms
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.strictEqual(focus.focusing(), false);
  assert.strictEqual(pushed.length, 1);
});

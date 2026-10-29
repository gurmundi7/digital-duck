const test = require("node:test");
const assert = require("node:assert");
const { createAwake } = require("../electron/awake.cjs");

function fakeBlocker() {
  const started = new Set();
  let next = 1;
  return {
    calls: [],
    start(type) { const id = next++; started.add(id); this.calls.push(["start", type]); return id; },
    stop(id) { started.delete(id); this.calls.push(["stop", id]); },
    isStarted: (id) => started.has(id),
  };
}

test("stay awake until told otherwise takes one display-sleep assertion", () => {
  const blocker = fakeBlocker();
  const changes = [];
  const awake = createAwake({ powerSaveBlocker: blocker, onChange: (c) => changes.push(c) });
  assert.strictEqual(awake.active(), false);
  awake.set(-1);
  assert.strictEqual(awake.active(), true);
  assert.strictEqual(awake.remainingMin(), 0);
  assert.deepStrictEqual(blocker.calls, [["start", "prevent-display-sleep"]]);
  assert.deepStrictEqual(changes, [{ active: true, minutes: -1, reason: "on", origin: "chat" }]);
});

test("a timed block reports the minutes left and ends on its own", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const blocker = fakeBlocker();
  const changes = [];
  const awake = createAwake({ powerSaveBlocker: blocker, onChange: (c) => changes.push(c) });
  awake.set(30);
  assert.strictEqual(awake.remainingMin(), 30);
  t.mock.timers.tick(29 * 60000);
  assert.strictEqual(awake.remainingMin(), 1);
  t.mock.timers.tick(60000);
  assert.strictEqual(awake.active(), false);
  assert.deepStrictEqual(changes.at(-1), { active: false, minutes: 0, reason: "timer" });
  assert.deepStrictEqual(blocker.calls, [["start", "prevent-display-sleep"], ["stop", 1]]);
});

test("changing the length keeps the same assertion", () => {
  const blocker = fakeBlocker();
  const awake = createAwake({ powerSaveBlocker: blocker });
  awake.set(60);
  awake.set(-1);
  awake.set(10);
  assert.strictEqual(blocker.calls.filter(([c]) => c === "start").length, 1);
  assert.strictEqual(awake.remainingMin(), 10);
  awake.stop();
});

test("zero, off and nonsense let the Mac sleep", () => {
  const blocker = fakeBlocker();
  const awake = createAwake({ powerSaveBlocker: blocker });
  assert.strictEqual(awake.set(0), false);
  awake.set(5);
  assert.strictEqual(awake.set("off"), true);
  assert.strictEqual(awake.active(), false);
  assert.strictEqual(awake.stop(), false);
});

test("a block is capped at twelve hours", () => {
  const awake = createAwake({ powerSaveBlocker: fakeBlocker() });
  awake.set(10000);
  assert.strictEqual(awake.remainingMin(), 12 * 60);
  awake.stop();
});

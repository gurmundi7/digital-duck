const test = require("node:test");
const assert = require("node:assert");

const nap = () => import("../renderer/src/nap.js");

test("a nap asked for while another is pending replaces it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { createNapper } = await nap();
  const calls = [];
  const n = createNapper({ sleep: () => calls.push("sleep"), onDone: (ms) => calls.push(`done ${ms}`) });
  n.start(10 * 60000); // the duck's own long nap
  t.mock.timers.tick(2000);
  n.start(5000); // the owner asks for a short one
  t.mock.timers.tick(1500);
  assert.deepStrictEqual(calls, ["sleep", "sleep"]);
  t.mock.timers.tick(3500);
  assert.deepStrictEqual(calls, ["sleep", "sleep", "done 5000"]);
  assert.strictEqual(n.pending, false);
  t.mock.timers.tick(10 * 60000);
  assert.deepStrictEqual(calls.filter((c) => c.startsWith("done")), ["done 5000"]); // the long nap never fires
});

test("an untimed nap lasts the random number of minutes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { createNapper } = await nap();
  const calls = [];
  const n = createNapper({ sleep: () => {}, onDone: (ms) => calls.push(ms), randomMinutes: () => 7 });
  n.start();
  assert.strictEqual(n.pending, true);
  t.mock.timers.tick(7 * 60000 - 1);
  assert.deepStrictEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(calls, [7 * 60000]);
});

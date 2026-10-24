const test = require("node:test");
const assert = require("node:assert");

const tags = () => import("../renderer/src/tags.js");

test("a nap tag with a length gives that many milliseconds", async () => {
  const { napMs } = await tags();
  assert.strictEqual(napMs("5s"), 5000);
  assert.strictEqual(napMs("10m"), 600000);
  assert.strictEqual(napMs("1h"), 3600000);
  assert.strictEqual(napMs("7"), 420000); // a bare number is minutes
});

test("a nap with no length, or a silly one, stays a normal nap", async () => {
  const { napMs } = await tags();
  assert.strictEqual(napMs(undefined), null);
  assert.strictEqual(napMs("soon"), null);
  assert.strictEqual(napMs("0s"), null);
  assert.strictEqual(napMs("99h"), null);
});

test("asking for a timed sleep in plain words becomes a timed nap", async () => {
  const { napFromRequest } = await tags();
  assert.strictEqual(napFromRequest("go to sleep and wake up after 5 s"), "nap 5s");
  assert.strictEqual(napFromRequest("take a nap for 10 minutes"), "nap 10m");
  assert.strictEqual(napFromRequest("sleep for 30 seconds please"), "nap 30s");
  assert.strictEqual(napFromRequest("go to sleep"), null);
  assert.strictEqual(napFromRequest("remind me in 5 minutes"), null);
  assert.strictEqual(napFromRequest("wake me up in 20 minutes"), null); // a reminder for the owner
});

test("a timed nap says how long it is, in the unit the owner used", async () => {
  const { napText } = await tags();
  assert.strictEqual(napText(5000), "5 seconds");
  assert.strictEqual(napText(1000), "1 second");
  assert.strictEqual(napText(600000), "10 minutes");
  assert.strictEqual(napText(60000), "1 minute");
  assert.strictEqual(napText(3600000), "1 hour");
  assert.strictEqual(napText(7200000), "2 hours");
  assert.strictEqual(napText(90 * 60000), "90 minutes");
});

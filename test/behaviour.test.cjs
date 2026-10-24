const test = require("node:test");
const assert = require("node:assert");

// Just enough body for the pet brain: sits only on legs and only when free.
function fakeSim({ busy = false, loco = "legs" } = {}) {
  const calls = [];
  const sim = {
    busy, loco, mode: "walk", sitting: false, paused: false, grabbed: false, variant: "classic",
    calls,
    isBusy: () => sim.busy,
    sit() { calls.push("sit"); if (sim.busy || sim.loco !== "legs" || sim.mode !== "walk") return false; sim.mode = "sitstand"; sim.sitting = true; return true; },
    // Like the real sim, a switch resets the body, and main.js answers a reset with onDropped.
    async setLoco(name) { calls.push(`loco:${name}`); sim.loco = name; sim.onReset?.(); return true; },
    stand() { sim.mode = "walk"; sim.sitting = false; },
    setPaused(p) { sim.paused = p; },
    getPose: () => ({ x: 0, y: 0, z: sim.sitting ? 0.05 : 0.12, yaw: 0, speed: 0 }),
    getSupport: () => ({ platform: null }),
    getPlatforms: () => [],
    getBall: () => null,
    velLimits: () => [0.25, -0.2, 1.0],
    heads: [],
    setHead(...h) { sim.heads.push(h); },
    setTwist() {}, setJaw() {}, crouch() {}, roll() {}, groundPick() {}, kick() {},
    startGrab() {}, moveGrab() {}, endGrab() {},
  };
  return sim;
}

async function brainFor(sim) {
  const { createBehaviour } = await import("../renderer/src/behaviour.js");
  let slept = false;
  const b = createBehaviour({ sim, halfX: 1, audio: { chirp: () => 0 }, onSleep: () => { slept = true; } });
  sim.onReset = () => b.onDropped();
  return { b, asleep: () => slept };
}

const run = async (b, seconds) => { for (let t = 0; t < seconds * 30; t++) { b.update(1 / 30, t * 33); await null; } };

test("sleep asked for while the body is busy still ends asleep once it is free", async () => {
  const sim = fakeSim({ busy: true });
  const { b, asleep } = await brainFor(sim);
  b.sleep();
  await run(b, 1);
  sim.busy = false;
  await run(b, 2);
  assert.strictEqual(b.state, "sleep");
  assert.ok(asleep());
});

test("sleep on skates takes them off, sits and sleeps", async () => {
  const sim = fakeSim({ loco: "rollers" });
  const { b, asleep } = await brainFor(sim);
  b.sleep();
  await run(b, 2);
  assert.ok(sim.calls.includes("loco:legs"));
  assert.strictEqual(b.state, "sleep");
  assert.ok(asleep());
});

test("on skates the head stays straight, even with the cursor off to one side", async () => {
  const sim = fakeSim({ loco: "rollers" });
  const { b } = await brainFor(sim);
  b.setCursor({ x: -0.8, yPx: 100, headPx: 400 });
  await run(b, 1);
  assert.ok(sim.heads.length > 0);
  for (const h of sim.heads) assert.deepStrictEqual(h, [0, 0, 0, 0]);
});

test("on legs the head still follows the cursor", async () => {
  const sim = fakeSim();
  const { b } = await brainFor(sim);
  b.setCursor({ x: -0.8, yPx: 100, headPx: 400 });
  await run(b, 1);
  assert.ok(sim.heads.some((h) => h[2] !== 0));
});

test("a sleep asked for mid-trick survives the reset when the trick fails", async () => {
  const sim = fakeSim({ busy: true });
  const { b, asleep } = await brainFor(sim);
  b.sleep();
  await run(b, 0.5);
  sim.onReset();
  sim.busy = false;
  await run(b, 2);
  assert.strictEqual(b.state, "sleep");
  assert.ok(asleep());
});

test("on skates a far goto stops short of the screen edge, leaving room to coast", async () => {
  const skating = await brainFor(fakeSim({ loco: "rollers" }));
  skating.b.goTo(5);
  const walking = await brainFor(fakeSim());
  walking.b.goTo(5);
  assert.ok(skating.b.target.x <= 1 - 0.45, `skate target ${skating.b.target.x}`);
  assert.ok(walking.b.target.x > skating.b.target.x);
});

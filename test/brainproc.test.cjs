const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter, once } = require("node:events");
const { PassThrough } = require("node:stream");
const { createBrainProcess } = require("../electron/brainproc.cjs");

// A fake claude: answers each stream-json question with a result line, from one conversation.
function fakeClaude({ answer = (q) => `heard ${q}`, silent = false } = {}) {
  const spawned = [];
  const spawn = (_bin, args) => {
    const proc = new EventEmitter();
    proc.stdin = new PassThrough(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    proc.args = args;
    proc.killed = false;
    proc.kill = () => { proc.killed = true; setImmediate(() => proc.emit("close", null)); };
    const i = args.indexOf("--resume");
    const sid = i >= 0 ? args[i + 1] : `s${spawned.length + 1}`;
    let buf = "";
    proc.stdin.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (silent) continue;
        const q = JSON.parse(line).message.content;
        proc.stdout.write(`${JSON.stringify({ type: "system", session_id: sid })}\n${JSON.stringify({ type: "result", session_id: sid, result: answer(q) })}\n`);
      }
    });
    spawned.push(proc);
    return proc;
  };
  return { spawn, spawned };
}

test("one process answers question after question", async () => {
  const f = fakeClaude();
  const brain = createBrainProcess({ spawn: f.spawn, bin: "claude" });
  const first = await brain.ask("one", ["--model", "haiku"], null);
  assert.strictEqual(first.result, "heard one");
  const second = await brain.ask("two", ["--model", "haiku"], first.session_id);
  assert.strictEqual(second.result, "heard two");
  assert.strictEqual(f.spawned.length, 1);
  assert.ok(f.spawned[0].args.includes("stream-json"));
});

test("changed arguments or a different conversation start a new process", async () => {
  const f = fakeClaude();
  const brain = createBrainProcess({ spawn: f.spawn, bin: "claude" });
  const first = await brain.ask("one", ["--model", "haiku"], null);
  await brain.ask("two", ["--model", "sonnet"], first.session_id);
  assert.strictEqual(f.spawned.length, 2);
  assert.ok(f.spawned[0].killed);
  assert.deepStrictEqual(f.spawned[1].args.slice(-2), ["--resume", "s1"]);
  await brain.ask("three", ["--model", "sonnet"], null);
  assert.strictEqual(f.spawned.length, 3);
  assert.ok(!f.spawned[2].args.includes("--resume"));
});

test("a process that exits fails the question and the next one starts fresh", async () => {
  const f = fakeClaude({ silent: true });
  const brain = createBrainProcess({ spawn: f.spawn, bin: "claude" });
  const asked = brain.ask("one", [], null);
  f.spawned[0].stderr.write("No conversation found\n");
  f.spawned[0].emit("close", 1);
  const res = await asked;
  assert.strictEqual(res.is_error, true);
  assert.match(res.result, /No conversation found/);
  assert.strictEqual(brain.running, false);
});

test("a question that takes too long times out and stops the process", async () => {
  const f = fakeClaude({ silent: true });
  const brain = createBrainProcess({ spawn: f.spawn, bin: "claude", timeoutMs: 20 });
  const res = await brain.ask("one", [], null);
  assert.deepStrictEqual(res, { is_error: true, result: "timed out" });
  assert.ok(f.spawned[0].killed);
});

test("warm starts the process before the first question", async () => {
  const f = fakeClaude();
  const brain = createBrainProcess({ spawn: f.spawn, bin: "claude" });
  brain.warm(["--model", "haiku"], null);
  assert.strictEqual(f.spawned.length, 1);
  await brain.ask("one", ["--model", "haiku"], null);
  assert.strictEqual(f.spawned.length, 1);
});

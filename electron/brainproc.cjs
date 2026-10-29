// One long-lived `claude` process answers every question. Starting the CLI costs about five
// seconds; a warm process answers a short question in under one. Questions go in one at a time
// as stream-json lines and the `result` event ends each answer. The process starts again when
// its arguments change, when the conversation to resume is a different one, or after it exits.
const readline = require("node:readline");

function createBrainProcess({ spawn, bin, cwd, env = () => process.env, timeoutMs = 180000, log = () => {} }) {
  let child = null, startedWith = "", conversation = null, pending = null;

  function start(args, resume) {
    startedWith = JSON.stringify(args);
    conversation = resume ?? null;
    const proc = spawn(bin, ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      ...args, ...(resume ? ["--resume", resume] : [])], { cwd, env: env() });
    let err = "";
    proc.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.session_id && proc === child) conversation = ev.session_id;
      if (ev.type === "result") settle(ev);
    });
    const ended = (why) => {
      if (child === proc) child = null;
      settle({ is_error: true, result: err.trim() || why });
    };
    proc.on("close", (code) => ended(`exit ${code}`));
    proc.on("error", (e) => ended(e.message));
    child = proc;
    log(`[brain] started${resume ? `, resuming ${resume.slice(0, 8)}` : ""}`);
  }

  function settle(ev) {
    const p = pending;
    pending = null;
    p?.(ev);
  }

  function stop() {
    const proc = child;
    child = null;
    proc?.stdin.end();
    proc?.kill("SIGTERM");
  }

  function ask(text, args, resume) {
    if (pending) return Promise.resolve({ is_error: true, result: "busy" });
    if (child && (JSON.stringify(args) !== startedWith || (resume ?? null) !== conversation)) stop();
    if (!child) start(args, resume);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { settle({ is_error: true, result: "timed out" }); stop(); }, timeoutMs);
      pending = (ev) => { clearTimeout(timer); resolve(ev); };
      child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`);
    });
  }

  // Start ahead of the first question so it is answered warm too.
  function warm(args, resume) { if (!child) start(args, resume); }

  return { ask, warm, stop, get running() { return Boolean(child); } };
}

module.exports = { createBrainProcess };

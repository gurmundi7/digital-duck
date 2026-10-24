// The owner's open pull requests, through the gh CLI: checks turning red or
// green, a review landing, new comments. Nothing is posted; it only reads.
const { execFile } = require("node:child_process");

function gh(args, cb) {
  execFile("gh", args, { timeout: 60000, maxBuffer: 4e6, env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` } }, (err, stdout) => {
    if (err) return cb(err);
    try { cb(null, JSON.parse(stdout)); } catch (e) { cb(e); }
  });
}
function summarise(checks) {
  let failed = 0, pending = 0, total = 0;
  for (const c of checks ?? []) {
    total++;
    const s = (c.conclusion || c.state || "").toUpperCase();
    if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(s)) failed++;
    else if (["PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", ""].includes(s)) pending++;
  }
  return total === 0 ? "none" : failed ? "red" : pending ? "pending" : "green";
}

function createPrWatch({ onEvent, log = () => {}, everyMs = 240000 }) {
  const known = new Map(); // url -> { checks, review, comments, title, number, repo }
  let timer = null, first = true, busy = false;

  function poll() {
    if (busy) return; busy = true;
    gh(["search", "prs", "--author=@me", "--state=open", "--json", "number,title,repository,url,isDraft", "--limit", "30"], (err, prs) => {
      if (err) { busy = false; log(`[prs] ${err.message.slice(0, 100)}`); return; }
      const urls = new Set();
      let left = prs.length;
      if (!left) { busy = false; first = false; return; }
      for (const pr of prs) {
        const repo = pr.repository.nameWithOwner;
        urls.add(pr.url);
        gh(["pr", "view", String(pr.number), "-R", repo, "--json", "statusCheckRollup,reviewDecision,comments,reviews"], (e2, v) => {
          if (!e2 && v) {
            const cur = { checks: summarise(v.statusCheckRollup), review: v.reviewDecision || "", comments: (v.comments?.length ?? 0) + (v.reviews?.length ?? 0), title: pr.title, number: pr.number, repo: pr.repository.name, draft: pr.isDraft };
            const prev = known.get(pr.url);
            known.set(pr.url, cur);
            if (prev && !first) diff(prev, cur, pr.url);
          }
          if (--left === 0) { for (const u of [...known.keys()]) if (!urls.has(u)) known.delete(u); busy = false; first = false; }
        });
      }
    });
  }
  function diff(prev, cur, url) {
    const name = `${cur.repo} ${cur.number}`;
    if (prev.checks !== cur.checks && cur.checks !== "pending" && cur.checks !== "none") {
      onEvent({ kind: "pr", text: cur.checks === "green" ? `Checks are green on ${name}, ${cur.title}.` : `CI went red on ${name}, ${cur.title}.`, url });
    }
    if (prev.review !== cur.review && cur.review) {
      const what = cur.review === "APPROVED" ? "was approved" : cur.review === "CHANGES_REQUESTED" ? "has changes requested" : "got a review";
      onEvent({ kind: "pr", text: `${name} ${what}: ${cur.title}.`, url });
    } else if (cur.comments > prev.comments) {
      const n = cur.comments - prev.comments;
      onEvent({ kind: "pr", text: `${n === 1 ? "A new comment" : `${n} new comments`} on ${name}, ${cur.title}.`, url });
    }
  }
  return {
    start() { if (!timer) { timer = setInterval(poll, everyMs); setTimeout(poll, 8000); } },
    stop() { clearInterval(timer); timer = null; },
    summary() { return [...known.values()].filter((p) => !p.draft); },
  };
}

module.exports = { createPrWatch };

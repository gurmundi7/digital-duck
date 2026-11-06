// Whether a newer release is out. One request to GitHub's latest-release endpoint a day:
// no account, no ID, nothing about the owner. The duck only points at the release page.
const DAY_MS = 24 * 60 * 60 * 1000;

const parts = (v) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim())?.slice(1).map(Number) ?? null;

function isNewer(latest, current) {
  const a = parts(latest), b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// The release GitHub calls latest, or null for anything that isn't a plain published release.
function parseRelease(body, repo) {
  if (!body || body.draft || body.prerelease) return null;
  const version = String(body.tag_name ?? "").replace(/^v/, "");
  const url = String(body.html_url ?? "");
  if (!parts(version) || !url.startsWith(`https://github.com/${repo}/releases/`)) return null;
  return { version, url };
}

function createUpdateCheck({ fetch, current, repo, onFound, everyMs = DAY_MS, log = () => {} }) {
  let timer = null;
  let found = null;
  async function check() {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "Digital-Duck" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { log(`[update] GitHub said ${res.status}`); return; }
      const release = parseRelease(await res.json(), repo);
      if (!release || !isNewer(release.version, current) || release.version === found?.version) return;
      found = release;
      log(`[update] ${release.version} is out (this is ${current})`);
      onFound(release);
    } catch (err) {
      log(`[update] check failed: ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }
  return {
    start() { if (timer) return; check(); timer = setInterval(check, everyMs); },
    stop() { clearInterval(timer); timer = null; },
    latest: () => found,
    check,
  };
}

module.exports = { isNewer, parseRelease, createUpdateCheck };

const test = require("node:test");
const assert = require("node:assert");
const { isNewer, parseRelease, createUpdateCheck } = require("../electron/updates.cjs");

const REPO = "gurmundi7/digital-duck";
const release = (tag, extra = {}) => ({ tag_name: tag, html_url: `https://github.com/${REPO}/releases/tag/${tag}`, draft: false, prerelease: false, ...extra });

test("only a higher version counts as newer", () => {
  assert.strictEqual(isNewer("0.3.1", "0.3.0"), true);
  assert.strictEqual(isNewer("v0.10.0", "0.9.9"), true);
  assert.strictEqual(isNewer("0.3.0", "0.3.0"), false);
  assert.strictEqual(isNewer("0.2.1", "0.3.0"), false);
  assert.strictEqual(isNewer("0.4.0-beta.1", "0.3.0"), false);
  assert.strictEqual(isNewer("latest", "0.3.0"), false);
});

test("a release is used only when it is published and points at this repo", () => {
  assert.deepStrictEqual(parseRelease(release("v0.3.1"), REPO), { version: "0.3.1", url: `https://github.com/${REPO}/releases/tag/v0.3.1` });
  assert.strictEqual(parseRelease(release("v0.3.1", { draft: true }), REPO), null);
  assert.strictEqual(parseRelease(release("v0.3.1", { prerelease: true }), REPO), null);
  assert.strictEqual(parseRelease(release("v0.3.1", { html_url: "https://example.com/duck.dmg" }), REPO), null);
  assert.strictEqual(parseRelease(null, REPO), null);
});

const fakeFetch = (body, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });

test("a newer release is announced once", async () => {
  const seen = [];
  const updates = createUpdateCheck({ fetch: fakeFetch(release("v0.3.2")), current: "0.3.1", repo: REPO, onFound: (r) => seen.push(r.version) });
  await updates.check();
  await updates.check();
  assert.deepStrictEqual(seen, ["0.3.2"]);
  assert.strictEqual(updates.latest().version, "0.3.2");
});

test("the same version, a GitHub error or no network stays quiet", async () => {
  const seen = [];
  const onFound = (r) => seen.push(r);
  await createUpdateCheck({ fetch: fakeFetch(release("v0.3.1")), current: "0.3.1", repo: REPO, onFound }).check();
  await createUpdateCheck({ fetch: fakeFetch({}, 403), current: "0.3.1", repo: REPO, onFound }).check();
  await createUpdateCheck({ fetch: async () => { throw new Error("offline"); }, current: "0.3.1", repo: REPO, onFound }).check();
  assert.deepStrictEqual(seen, []);
});

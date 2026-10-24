// The public repo carries duck skins only and nothing personal.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
// The private checkout keeps the skins overlay and its own README at the root, so it is not a public tree.
const PRIVATE_CHECKOUT = fs.existsSync(path.join(ROOT, "private-skins")) && "private checkout";
const SKIP = new Set(["node_modules", "dist", "release", "build", "state", "private", ".git", "sim", "test"]);
function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(c?js|swift|json|html|sh|md|plist)$/.test(e.name) && e.name !== "package-lock.json") yield p;
  }
}

test("no pigeon skin, character or sound in the public source", { skip: PRIVATE_CHECKOUT }, () => {
  for (const f of files(ROOT)) {
    const hit = /hermes|pigeon|\bdove\b|\bcoo(ing|s)?\b|courier|\bslate\b/i.exec(fs.readFileSync(f, "utf8"));
    assert.strictEqual(hit, null, `${path.relative(ROOT, f)} mentions "${hit?.[0]}"`);
  }
});

test("no personal ids or paths in the public source", { skip: PRIVATE_CHECKOUT }, () => {
  for (const f of files(ROOT)) {
    const hit = /gsingh|\/Users\/[a-z]|\.local\/state\/dashboard/i.exec(fs.readFileSync(f, "utf8"));
    assert.strictEqual(hit, null, `${path.relative(ROOT, f)} has "${hit?.[0]}"`);
  }
});

// Every console line from the main process also lands in a file in the state folder, so a
// normal launch (no terminal) still leaves a trail. When the file passes maxBytes it moves
// to <file>.1, replacing the older one, and a fresh file starts.
const fs = require("node:fs");
const util = require("node:util");

const stamp = (d) => d.toLocaleString("sv-SE").replace(",", "");

function attachLogFile(file, { maxBytes = 2 * 1024 * 1024, target = console, now = () => new Date() } = {}) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { /* starts empty */ }
  for (const level of ["log", "info", "warn", "error"]) {
    const original = target[level].bind(target);
    target[level] = (...args) => {
      original(...args);
      const line = `${stamp(now())} ${util.format(...args)}\n`;
      try {
        if (size > 0 && size + Buffer.byteLength(line) > maxBytes) { fs.renameSync(file, `${file}.1`); size = 0; }
        fs.appendFileSync(file, line);
        size += Buffer.byteLength(line);
      } catch { /* a full disk must not take the duck down */ }
    };
  }
}

module.exports = { attachLogFile };

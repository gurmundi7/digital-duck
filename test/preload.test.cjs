const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");

// Loads the pet window's preload with a fake electron and records what each call sends.
function petApi() {
  const sent = [];
  let api = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: { send: (...args) => sent.push(args), invoke: async () => null, on: () => {} },
  };
  const load = Module._load;
  Module._load = function (request, ...rest) { return request === "electron" ? electron : load.call(this, request, ...rest); };
  try {
    delete require.cache[require.resolve("../electron/preload.cjs")];
    require("../electron/preload.cjs");
  } finally {
    Module._load = load;
  }
  return { api, sent };
}

test("opening chat brings the window forward without touching a focus block", () => {
  const { api, sent } = petApi();
  api.focusWindow();
  assert.deepStrictEqual(sent, [["pet:focus-window"]]);
});

test("a focus block of N minutes goes to main with its length", () => {
  const { api, sent } = petApi();
  api.focus(45);
  assert.deepStrictEqual(sent, [["pet:focus", 45]]);
});

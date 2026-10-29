const test = require("node:test");
const assert = require("node:assert");
const { musicFromRequest, createMusic } = require("../electron/music.cjs");

test("plain music requests run directly", () => {
  const cases = {
    "pause the music": "pause", "Pause.": "pause", "stop the music please": "pause",
    "play it again": "play", "resume": "play", "play music": "play",
    "next song please": "next", "skip this ad": "next", "skip": "next",
    "previous song": "previous", "go back a song": "previous",
    "what's playing?": "nowPlaying", "what song is this": "nowPlaying",
    "volume up": "volumeUp", "turn it down": "volumeDown", "turn the music up": "volumeUp",
  };
  for (const [text, action] of Object.entries(cases)) assert.strictEqual(musicFromRequest(text)?.action, action, text);
  assert.deepStrictEqual(musicFromRequest("set the volume to 30%"), { action: "volume", level: 30 });
  assert.deepStrictEqual(musicFromRequest("volume 150"), { action: "volume", level: 100 });
});

test("everything else goes to the brain", () => {
  for (const text of ["play something chill", "let's play ball", "skip the standup today", "be quiet", "stop", "what's next on my calendar", "next meeting?", "stop focus"]) {
    assert.strictEqual(musicFromRequest(text), null, text);
  }
});

function fakeRun(state) {
  const calls = [];
  const run = (file, args, _opts, cb) => {
    calls.push([file.split("/").pop(), ...args]);
    if (args[0] === "get") return cb(null, JSON.stringify(state.playing === null ? null : { title: state.title, artist: state.artist, playing: state.playing }));
    if (args[0] === "pause") state.playing = false;
    if (args[0] === "play") state.playing = true;
    if (args[0] === "next-track") state.title = "Paper Boats";
    if (file === "osascript" && /^set volume output volume (\d+)/.test(args[1])) state.volume = Number(RegExp.$1);
    if (file === "osascript" && /output volume of/.test(args[1])) return cb(null, `${state.volume}\n`);
    cb(null, "");
  };
  return { run, calls };
}
const music = (state) => { const f = fakeRun(state); return { f, m: createMusic({ run: f.run, bin: "/opt/homebrew/bin/media-control", wait: async () => {} }) }; };

test("actions report what happened", async () => {
  const state = { title: "Morning Tide", artist: "The Quiet Ponds", playing: true, volume: 50 };
  const { m } = music(state);
  assert.strictEqual(await m.act("nowPlaying"), '"Morning Tide" by The Quiet Ponds.');
  assert.strictEqual(await m.act("next"), 'Next up: "Paper Boats" by The Quiet Ponds.');
  assert.strictEqual(await m.act("pause"), "Paused.");
  assert.strictEqual(state.playing, false);
  assert.strictEqual(await m.act("volumeUp"), "Volume 60.");
  assert.strictEqual(await m.act("volume", 5), "Volume 5.");
  assert.strictEqual(await m.act("volumeDown"), "Volume 0.");
});

test("without media-control the player commands say how to get it, volume still works", async () => {
  const state = { volume: 40 };
  const m = createMusic({ run: fakeRun(state).run, bin: null });
  assert.match(await m.act("pause"), /brew install media-control/);
  assert.strictEqual(await m.act("volumeUp"), "Volume 50.");
});

test("a call pauses playing music and plays it again afterwards", async () => {
  const state = { title: "Morning Tide", playing: true };
  const { m } = music(state);
  await m.callStarted();
  await m.callStarted();
  assert.strictEqual(state.playing, false);
  await m.callEnded();
  assert.strictEqual(state.playing, true);
});

test("music the owner had paused stays paused after the call", async () => {
  const state = { title: "Morning Tide", playing: false };
  const { m, f } = music(state);
  await m.callStarted();
  await m.callEnded();
  assert.strictEqual(state.playing, false);
  assert.ok(!f.calls.some((c) => c[1] === "play"));
});

test("listening pauses the music and the heard request decides whether it plays again", async () => {
  const state = { title: "Morning Tide", playing: true };
  const { m } = music(state);
  m.listenStarted();
  await m.listenStarted();
  assert.strictEqual(state.playing, false);
  await m.listenEnded("what's the weather");
  assert.strictEqual(state.playing, true);
  m.listenStarted();
  await m.listenEnded("pause the music");
  assert.strictEqual(state.playing, false);
  state.playing = true;
  m.listenStarted();
  await m.listenEnded("can you stop the music for a bit");
  assert.strictEqual(state.playing, false);
  await m.listenEnded();
  assert.strictEqual(state.playing, false);
});

test("hold pauses only when something plays", async () => {
  const state = { title: "Morning Tide", playing: true };
  const { m } = music(state);
  const resume = await m.hold("announcement");
  assert.strictEqual(state.playing, false);
  await resume();
  assert.strictEqual(state.playing, true);
  state.playing = null;
  assert.strictEqual(await m.hold("announcement"), null);
});

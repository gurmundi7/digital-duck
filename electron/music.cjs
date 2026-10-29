// Music in whatever player the Mac shows as Now Playing (YouTube Music in a browser,
// Spotify, Music) through media-control, plus the Mac's output volume. Requests that
// match here run straight away, without a brain call.
const fs = require("node:fs");
const { execFile } = require("node:child_process");

const BINS = ["/opt/homebrew/bin/media-control", "/usr/local/bin/media-control"];
const STEP = 10;

// The owner's words to { action, level? }, or null when it is not a plain music request.
// Anything looser ("play something chill") is left to the brain.
function musicFromRequest(text) {
  const t = String(text ?? "").toLowerCase().replace(/[.!?,]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(hey duck |duck |please )+|( please)+$/g, "");
  if (/\b(what('?s| is) (playing|this song|this track|that song|the song)|what song is (this|that|playing|on)|which song is this|who sings this)\b/.test(t)) return { action: "nowPlaying" };
  const level = /\bvolume (to |at )?(\d{1,3})( ?%| percent)?\b/.exec(t);
  if (level) return { action: "volume", level: Math.min(100, Number(level[2])) };
  if (/\b(volume up|turn (it|the music|the volume|this) up|(raise|increase) the volume|(music|it) louder)\b/.test(t)) return { action: "volumeUp" };
  if (/\b(volume down|turn (it|the music|the volume|this) down|(lower|decrease|reduce) the volume|(music|it) (quieter|softer))\b/.test(t)) return { action: "volumeDown" };
  if (/\b(next (song|track)|skip (this |the |that )?(song|track|ad|one)|play (the )?next (song|track|one))\b|^(next|skip|skip it)$/.test(t)) return { action: "next" };
  if (/\b(previous (song|track)|go back (a|one) (song|track)|play the (previous|last) (song|track)( again)?)\b|^previous$/.test(t)) return { action: "previous" };
  if (/\b(pause( the| this| my)? (music|song|track|it)|stop( the| this| my)? (music|song|track|playback))\b|^pause$/.test(t)) return { action: "pause" };
  if (/\b(resume|unpause)\b|\b(play|start) (the )?music$|\bplay it again\b|\bkeep playing\b|^play$/.test(t)) return { action: "play" };
  return null;
}

const songLine = (info) => (info?.title ? `"${info.title}"${info.artist ? ` by ${info.artist}` : ""}` : "");

function createMusic({ run = execFile, bin = BINS.find((p) => fs.existsSync(p)), wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = {}) {
  const exec = (file, args) => new Promise((resolve) => {
    run(file, args, { timeout: 5000 }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
  const control = (cmd) => (bin ? exec(bin, [cmd]) : Promise.resolve(null));
  async function nowPlaying() {
    if (!bin) return null;
    try { return JSON.parse(await exec(bin, ["get"])); } catch { return null; }
  }
  async function volume(set) {
    if (set !== undefined) await exec("osascript", ["-e", `set volume output volume ${set}`]);
    return Number(await exec("osascript", ["-e", "output volume of (get volume settings)"]));
  }

  // Runs one action and returns the line the duck shows (and says, when asked by chat or voice).
  async function act(action, level) {
    if (action === "volume") return `Volume ${await volume(level)}.`;
    if (action === "volumeUp" || action === "volumeDown") {
      const now = await volume();
      return `Volume ${await volume(Math.max(0, Math.min(100, now + (action === "volumeUp" ? STEP : -STEP))))}.`;
    }
    if (!bin) return "I need media-control for music: brew install media-control.";
    if (action === "nowPlaying") { const info = await nowPlaying(); return info?.title ? `${songLine(info)}.` : "Nothing's playing."; }
    const cmd = { play: "play", pause: "pause", playPause: "toggle-play-pause", next: "next-track", previous: "previous-track" }[action];
    if (!cmd) return "";
    await control(cmd);
    if (action === "pause") return "Paused.";
    await wait(1200);
    const info = await nowPlaying();
    const song = songLine(info);
    if (action === "next") return song ? `Next up: ${song}.` : "Skipped.";
    if (action === "previous") return song ? `Back to ${song}.` : "Went back.";
    return info?.playing === false ? "Paused." : song ? `Playing ${song}.` : "Playing.";
  }

  // Pauses what is playing and hands back a resume, or null when nothing was playing.
  async function hold(reason) {
    const info = await nowPlaying();
    if (!info?.playing) return null;
    await control("pause");
    log(`[music] paused for ${reason}: ${songLine(info)}`);
    return () => { log(`[music] resumed after ${reason}`); return control("play"); };
  }

  // A call pauses the music once and the end of the call plays it again, only when the duck paused it.
  let callHold = null;
  function callStarted() { if (!callHold) callHold = hold("call"); return callHold; }
  async function callEnded() { const pending = callHold; callHold = null; const resume = await pending; await resume?.(); }

  // Talking to the duck pauses the music; it plays again once the exchange is over, unless you asked her to stop it.
  let listenHold = null;
  function listenStarted() { if (!listenHold) listenHold = hold("listening"); return listenHold; }
  async function listenEnded(heard = "") {
    const pending = listenHold;
    listenHold = null;
    const resume = await pending;
    if (!asksToStop(heard)) await resume?.();
  }

  return { act, nowPlaying, hold, callStarted, callEnded, listenStarted, listenEnded, get available() { return Boolean(bin); } };
}

// "Pause", or a looser "stop the music" that the brain handles.
function asksToStop(heard) {
  if (musicFromRequest(heard)?.action === "pause") return true;
  return /\b(stop|pause|mute|kill)\b/i.test(heard) && /\b(music|song|track|it|this|that|playing)\b/i.test(heard);
}

module.exports = { musicFromRequest, createMusic };

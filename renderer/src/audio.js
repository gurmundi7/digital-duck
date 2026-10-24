// Chirps from the robot's voice bank and footstep taps. Web Audio with a
// decode-once cache; everything hangs off one master gain for mute.
import { skin } from "./skins.js";

const CHIRP_TAKES = "abcdefghijkl";
const STEP_TAKES = "abcde";
const VOICE_BANK = { classic: "duck1", charcoal: "duck2", purple: "duck3", blue: "duck4" };

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let hush = false; // silent during a call, independent of the user's mute
  const cache = new Map();

  function ensure() {
    if (ctx) return ctx;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted || hush ? 0 : 0.8;
    master.connect(ctx.destination);
    return ctx;
  }
  function bufferFor(url) {
    let p = cache.get(url);
    if (!p) {
      p = fetch(url).then((r) => r.arrayBuffer()).then((ab) => ensure().decodeAudioData(ab));
      cache.set(url, p);
    }
    return p;
  }
  function play(url, { gain = 1, rate = 1 } = {}) {
    const c = ensure();
    if (c.state === "suspended") c.resume().catch(() => {});
    bufferFor(url).then((buf) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = c.createGain();
      g.gain.value = gain;
      src.connect(g);
      g.connect(master);
      src.onended = () => g.disconnect();
      src.start();
    }).catch(() => {});
  }
  let wheee = null; // { src, gain } while skating fast
  function setWheee(on, variant = "classic") {
    const c = ensure();
    if (on && !wheee) {
      const bank = VOICE_BANK[variant] ?? "duck1";
      const g = c.createGain(); g.gain.value = 0; g.connect(master);
      const holder = { src: null, gain: g };
      wheee = holder;
      bufferFor(`./assets/voices/${bank}/wheee_loop_${"ab"[(Math.random() * 2) | 0]}.wav`).then((buf) => {
        if (wheee !== holder) return;
        const src = c.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(g); src.start();
        holder.src = src;
        g.gain.setTargetAtTime(0.35, c.currentTime, 0.05);
      }).catch(() => {});
    } else if (!on && wheee) {
      const h = wheee; wheee = null;
      h.gain.gain.setTargetAtTime(0, c.currentTime, 0.08);
      setTimeout(() => { try { h.src?.stop(); } catch { /* already stopped */ } h.gain.disconnect(); }, 400);
    }
  }
  return {
    setWheee,
    chirp(variant = "classic") {
      const own = skin(variant)?.chirp;
      if (own) {
        const c = ensure();
        if (c.state === "suspended") c.resume().catch(() => {});
        return own({ ctx: c, out: master });
      }
      const bank = VOICE_BANK[variant] ?? "duck1";
      const take = CHIRP_TAKES[(Math.random() * CHIRP_TAKES.length) | 0];
      play(`./assets/voices/${bank}/chirp_${take}.wav`, { gain: 0.6 });
      return 480;
    },
    step(u) {
      const take = STEP_TAKES[(Math.random() * STEP_TAKES.length) | 0];
      play(`./assets/sfx/step_${take}.wav`, { gain: 0.08 + 0.1 * u, rate: 0.9 + Math.random() * 0.25 });
    },
    thump(u = 0.5) {
      play(`./assets/sfx/thump_${"abc"[(Math.random() * 3) | 0]}.wav`, { gain: 0.1 + 0.25 * u, rate: 0.7 + 0.2 * u });
    },
    setMuted(v) {
      muted = v;
      if (master) master.gain.setTargetAtTime(muted || hush ? 0 : 0.8, ctx.currentTime, 0.02);
    },
    setHush(v) {
      hush = v;
      if (master) master.gain.setTargetAtTime(muted || hush ? 0 : 0.8, ctx.currentTime, 0.02);
    },
    get muted() { return muted || hush; },
  };
}

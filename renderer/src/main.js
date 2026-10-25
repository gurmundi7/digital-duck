import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createPetSim } from "./pet-sim.js";
import { createBehaviour } from "./behaviour.js";
import { createAudio } from "./audio.js";
import { createBubble } from "./bubble.js";
import { createRecorder } from "./recorder.js";
import { applySkin, variantNames, variantAliases } from "./skins.js";
import { createWants } from "./wants.js";
import { line } from "./lines.js";
import { napMs, napText, napFromRequest } from "./tags.js";
import { createNapper } from "./nap.js";

const PX_PER_M = 640; // the 25 cm duck stands about 160 px tall
const FLOOR_PX = 12; // floor line sits this far above the window's bottom edge
const pet = window.pet;
const log = (...a) => { console.log(...a); pet?.log(...a); };

const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true });
// Only a box around the duck is drawn; it slides with the duck, and the
// full-window camera below stays the one source of truth for screen <-> world.
const VIEW_W = 640, VIEW_H = 560;
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
renderer.setSize(VIEW_W, VIEW_H, false);
canvas.style.width = `${VIEW_W}px`;
canvas.style.height = `${VIEW_H}px`;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment()).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 4, 2); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-2, 2, 1.5); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffb366, 0.7); rim.position.set(0, 3, -2); scene.add(rim);

const worldW = innerWidth / PX_PER_M;
const worldH = innerHeight / PX_PER_M;
const halfX = worldW / 2 - 0.1;
const halfY = 0.18;

// Orthographic strip camera: world x maps linearly to screen x, with a
// gentle downward pitch so the duck reads as standing on the Dock edge.
const camera = new THREE.OrthographicCamera(-worldW / 2, worldW / 2, worldH, 0, 0.1, 50);
camera.position.set(0, 1.4, 8);
camera.lookAt(0, 0.12, 0);
camera.updateMatrixWorld();
{
  const ndc = new THREE.Vector3(0, 0, 0).project(camera);
  const want = -1 + (2 * FLOOR_PX) / innerHeight;
  const shift = ((ndc.y - want) * (camera.top - camera.bottom)) / 2;
  camera.bottom += shift;
  camera.top += shift;
  camera.updateProjectionMatrix();
}

const Q_MJCF_TO_THREE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const viewCam = camera.clone();
let viewBox = { x0: 0, y0: 0 };
let curW = VIEW_W, curH = VIEW_H;
function viewSize(w, h) {
  w = Math.round(w); h = Math.round(h);
  if (w === curW && h === curH) return;
  curW = w; curH = h;
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}
function placeView() {
  const d = duckScreen();
  let cx = d.x, cy = d.y;
  const b = sim.getBall();
  if (b) { const bs = worldToScreen(b.x, b.z, -b.y); cx = (cx + bs.x) / 2; cy = Math.min(cy, bs.y) + 20; }
  viewSize(VIEW_W, VIEW_H);
  const x0 = Math.round(THREE.MathUtils.clamp(cx - curW / 2, 0, innerWidth - curW));
  const y0 = Math.round(THREE.MathUtils.clamp(cy - curH * 0.62, 0, innerHeight - curH));
  if (x0 !== viewBox.x0 || y0 !== viewBox.y0) {
    viewBox = { x0, y0 };
    canvas.style.transform = `translate(${x0}px, ${y0}px)`;
  }
  const W = innerWidth, H = innerHeight;
  const L = camera.left, R = camera.right, T = camera.top, B = camera.bottom;
  viewCam.left = L + (x0 / W) * (R - L);
  viewCam.right = L + ((x0 + curW) / W) * (R - L);
  viewCam.top = T - (y0 / H) * (T - B);
  viewCam.bottom = T - ((y0 + curH) / H) * (T - B);
  viewCam.position.copy(camera.position);
  viewCam.quaternion.copy(camera.quaternion);
  viewCam.updateProjectionMatrix();
  viewCam.updateMatrixWorld();
}

// Soft contact shadow so the duck sits on the floor line instead of floating.
const shadow = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.42)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  scene.add(m);
  return m;
})();

// Beach ball: striped sphere that follows the physics ball while it is in play.
const ball = (() => {
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  const stripes = ["#ff7a2f", "#fffdf7", "#2d7ff9", "#fffdf7", "#ffd23f", "#fffdf7"];
  stripes.forEach((col, i) => { g.fillStyle = col; g.fillRect((i * 256) / stripes.length, 0, 256 / stripes.length + 1, 128); });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  mesh.visible = false;
  return mesh;
})();
scene.add(ball);
const ballShadow = shadow.clone(); ballShadow.scale.set(0.45, 0.45, 1); ballShadow.visible = false; scene.add(ballShadow);

const audio = createAudio();
const sim = await createPetSim({ halfX, halfY, onFootstep: (u) => audio.step(u), onLog: log });
scene.add(sim.rig.placer);
log("duck ready");

const bubble = createBubble({
  onSubmit: (text) => ask(text),
  onOpenChange: (open) => { if (!open) { hover = cursorPx ? overDuck(cursorPx.x, cursorPx.y) : false; updateMouseGate(); } },
});

const behaviour = createBehaviour({
  sim, halfX, audio,
  onSleep: () => { asleep = true; renderOnce(); },
  onWake: () => { if (asleep) { asleep = false; last = performance.now(); requestAnimationFrame(frame); } },
});

// Window top edges become ledges. Windows arrive front to back in window-local
// CSS px; only the part of a top edge not hidden behind a nearer window counts.
function computeLedges(wins) {
  const out = [];
  const covers = [];
  const minTop = 0.36 * PX_PER_M; // a duck standing higher would poke out of the screen
  for (const w of wins) {
    const top = w.y;
    if (top < minTop || top > innerHeight - 24) { covers.push(w); continue; }
    let segs = [[Math.max(0, w.x), Math.min(innerWidth, w.x + w.w)]];
    for (const c of covers) {
      if (!(c.y < top && top < c.y + c.h)) continue;
      const ca = c.x, cb = c.x + c.w;
      segs = segs.flatMap(([a, b]) => {
        if (cb <= a || ca >= b) return [[a, b]];
        const keep = [];
        if (ca > a) keep.push([a, ca]);
        if (cb < b) keep.push([cb, b]);
        return keep;
      });
    }
    covers.push(w);
    const best = segs.filter(([a, b]) => b - a >= 160).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    if (!best) continue;
    const left = screenToWorld(best[0], top), right = screenToWorld(best[1], top);
    out.push({ x: (left.x + right.x) / 2, z: left.y, halfW: (right.x - left.x) / 2, owner: w.owner, id: w.id });
    if (out.length >= 8) break;
  }
  return out;
}
let lastWindows = [];
pet?.onWindows((wins) => { lastWindows = wins; sim.setPlatforms(computeLedges(wins)); });

sim.on((ev) => {
  if (ev.type !== "idle") log(`sim event: ${ev.type}`);
  if (ev.type === "rig") { scene.remove(ev.prevRig.placer); scene.add(ev.rig.placer); sim.syncRig(); applySkin(ev.rig, sim.variant); }
  if (ev.type === "fell") audio.thump(0.6);
  if (ev.type === "ball") behaviour.setBall(ev.active);
  if (ev.type === "reset") behaviour.onDropped();
});

// ── Screen <-> world ────────────────────────────────────────────────────
const _v = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // three z = 0 (MJCF y = 0)
function worldToScreen(x, y, z) {
  _v.set(x, y, z).project(camera);
  return { x: ((_v.x + 1) / 2) * innerWidth, y: ((1 - _v.y) / 2) * innerHeight };
}
function duckScreen() {
  sim.trunkGroup.getWorldPosition(_v);
  _v.project(camera);
  return { x: ((_v.x + 1) / 2) * innerWidth, y: ((1 - _v.y) / 2) * innerHeight };
}
function screenToWorld(px, py) {
  raycaster.setFromCamera({ x: (px / innerWidth) * 2 - 1, y: -(py / innerHeight) * 2 + 1 }, camera);
  const hit = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
  return hit ?? new THREE.Vector3((px / innerWidth - 0.5) * worldW, 0.12, 0);
}
function overDuck(px, py) {
  const d = duckScreen();
  const halfW = 0.15 * PX_PER_M;
  return Math.abs(px - d.x) < halfW && py < d.y + 0.14 * PX_PER_M && py > d.y - 0.22 * PX_PER_M;
}

// ── Mouse gate: the window ignores clicks except over the duck or bubble ─
let hover = false;
let gateOpen = null;
// The window takes the mouse only over the duck or its bubble; everywhere
// else clicks fall through to the apps behind it.
function updateMouseGate() {
  const want = hover || grabbing;
  if (want !== gateOpen) {
    gateOpen = want;
    pet?.setIgnoreMouse(!want);
  }
}

let grabbing = false;
let downAt = null;
let cursorPx = null;
let lastPointerAt = 0;
setInterval(() => {
  if (gateOpen && !grabbing && !bubble.hasInput && performance.now() - lastPointerAt > 1500) { hover = false; updateMouseGate(); }
}, 500);
window.addEventListener("mousemove", (e) => {
  lastPointerAt = performance.now();
  cursorPx = { x: e.clientX, y: e.clientY };
  trackStroke(e);
  const d = duckScreen();
  const near = Math.abs(e.clientX - d.x) < 420 && !asleep || Math.abs(e.clientX - d.x) < 160;
  behaviour.setCursor(near ? { x: screenToWorld(e.clientX, e.clientY).x, yPx: e.clientY, headPx: d.y - 0.12 * PX_PER_M } : null);
  if (grabbing) {
    const w = screenToWorld(e.clientX, e.clientY);
    sim.moveGrab([w.x, 0, Math.max(0.06, w.y)]);
    return;
  }
  hover = overDuck(e.clientX, e.clientY) || bubble.contains(e.clientX, e.clientY);
  updateMouseGate();
});
window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (bubble.contains(e.clientX, e.clientY)) return;
  if (!overDuck(e.clientX, e.clientY)) return;
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
window.addEventListener("mousemove", (e) => {
  if (!downAt || grabbing) return;
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) {
    grabbing = true;
    behaviour.setChatting(false);
    bubble.hide();
    const w = screenToWorld(e.clientX, e.clientY);
    sim.startGrab([w.x, 0, Math.max(0.06, w.y)]);
    updateMouseGate();
  }
});
window.addEventListener("mouseup", (e) => {
  if (e.button !== 0) return;
  if (grabbing) {
    grabbing = false;
    sim.endGrab();
    behaviour.onDropped();
    downAt = null;
    hover = overDuck(e.clientX, e.clientY);
    updateMouseGate();
    return;
  }
  if (downAt && performance.now() - downAt.t < 600) {
    behaviour.poke();
    openChat();
  }
  downAt = null;
});
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (overDuck(e.clientX, e.clientY) || bubble.contains(e.clientX, e.clientY)) pet?.contextMenu();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeChat();
});

// ── Nudges: the duck comes over, quacks, shows and says it ─────────────
const DELIVERED_KINDS = new Set(["reminder", "mail", "pr", "ticket"]);
function nudge({ kind, text }) {
  const said = DELIVERED_KINDS.has(kind) ? `${line(sim.variant, "deliver", { name: ownerName() })} ${text}` : text;
  const show = () => {
    bubble.show(said, { ttlMs: Math.min(40000, 7000 + said.length * 60) });
    if (!audio.muted) pet.say(said);
  };
  if (kind === "mail") wants?.chatted();
  behaviour.deliver(cursorPx ? screenToWorld(cursorPx.x, innerHeight - 20).x : null, show);
}
const ownerName = () => appConfig.name || "you";

// ── Phase 1: presence, greetings, wants, petting ───────────────────────
let settings = { pet: { greetings: true, wants: true, petting: true }, work: {} };
let presence = { present: true, hour: new Date().getHours(), weekend: [0, 6].includes(new Date().getDay()) };
let wants = null;
let lastGreetAt = -Infinity;
let lastNapAt = -Infinity, lastBidAt = -Infinity, lastSulkAt = -Infinity, lastWantsCheck = 0;
function speak(text, { ttlMs } = {}) {
  if (!text) return;
  bubble.show(text, { ttlMs: ttlMs ?? Math.min(20000, 5000 + text.length * 60) });
  if (!audio.muted) pet.say(text);
}
function greet(key, vars = {}) {
  if (settings.pet.greetings === false) return;
  const now = performance.now();
  if (now - lastGreetAt < 10 * 60000) return;
  const h = new Date().getHours();
  if (h >= 23 || h < 7) return;
  lastGreetAt = now;
  const v = { name: ownerName(), ...vars };
  let text = line(sim.variant, key, v);
  if (h >= 22) text = line(sim.variant, "late", v);
  else if (presence.weekend && Math.random() < 0.35) text = `${text} ${line(sim.variant, "weekend", v)}`;
  else if (h < 11 && Math.random() < 0.5) text = `${text} ${line(sim.variant, "morning", v)}`;
  else if (h >= 18 && Math.random() < 0.5) text = `${text} ${line(sim.variant, "evening", v)}`;
  behaviour.poke();
  speak(text);
}
function onPresence(cmd) {
  presence = { ...presence, present: !["away", "lock"].includes(cmd.event), hour: cmd.hour, weekend: cmd.weekend };
  const late = cmd.hour >= 22 || cmd.hour < 6;
  behaviour.setPace(late ? 1.8 : cmd.weekend ? 1.4 : 1);
  if (cmd.event === "launch") greet("launch");
  else if (cmd.event === "unlock") greet("unlock");
  else if (cmd.event === "back") greet(cmd.idleMin >= 25 ? "backLong" : "backShort", { min: cmd.idleMin });
}
function ensureWants(initial) {
  if (wants) return;
  wants = createWants({ initial, onSave: (w) => pet.saveWants(w) });
}
const napper = createNapper({
  sleep: () => behaviour.sleep(),
  onDone: (napFor) => {
    wants?.napped(napFor / 60000);
    // A short nap can end before the sit has turned into sleep.
    if (behaviour.state === "sleep" || behaviour.state === "sit") { behaviour.wakeUp(); speak(line(sim.variant, "napEnd"), { ttlMs: 5000 }); }
  },
});
function startNap(ms = null) {
  lastNapAt = performance.now();
  speak(ms ? `Zzz… ${napText(ms)}.` : line(sim.variant, "nap", { name: ownerName() }), { ttlMs: 6000 });
  napper.start(ms);
}
function wantsTick(dt) {
  if (!wants) return;
  const speed = sim.getPose().speed;
  wants.update(dt, { asleep: behaviour.state === "sleep", sitting: sim.sitting, moving: speed > 0.05, engaged: behaviour.engaged, ownerPresent: presence.present, hour: presence.hour, weekend: presence.weekend });
  const now = performance.now();
  if (now - lastWantsCheck < 2000) return;
  lastWantsCheck = now;
  if (settings.pet.wants === false || behaviour.focus || behaviour.engaged || behaviour.state === "sleep" || behaviour.state === "hop") return;
  if (wants.sleepy && now - lastNapAt > 40 * 60000 && !napper.pending) { startNap(); return; }
  if (!presence.present) return;
  if (wants.sulky && now - lastSulkAt > 20 * 60000 && !behaviour.sulking) {
    lastSulkAt = now; lastBidAt = now;
    speak(line(sim.variant, "sulk", { name: ownerName() }), { ttlMs: 6000 });
    behaviour.sulk();
  } else if (wants.bored && now - lastBidAt > (4 + Math.random() * 3) * 60000 && !behaviour.sulking) {
    lastBidAt = now;
    behaviour.attention(cursorPx ? screenToWorld(cursorPx.x, innerHeight - 20).x : null);
    speak(line(sim.variant, "bored", { name: ownerName() }), { ttlMs: 6000 });
  }
}
// Petting: a few quick back-and-forth strokes over the head.
let stroke = { xs: [], lastAt: 0, lastPetAt: -Infinity };
function overHead(px, py) {
  const d = duckScreen();
  return Math.abs(px - d.x) < 0.13 * PX_PER_M && py < d.y - 0.06 * PX_PER_M && py > d.y - 0.32 * PX_PER_M;
}
function trackStroke(e) {
  if (settings.pet.petting === false || grabbing || behaviour.state === "sleep") return;
  const now = performance.now();
  if (!overHead(e.clientX, e.clientY) || now - stroke.lastAt > 700) { stroke.xs = []; }
  stroke.lastAt = now;
  stroke.xs.push({ x: e.clientX, t: now });
  stroke.xs = stroke.xs.filter((p) => now - p.t < 1600);
  let reversals = 0, dir = 0;
  for (let i = 1; i < stroke.xs.length; i++) {
    const dx = stroke.xs[i].x - stroke.xs[i - 1].x;
    if (Math.abs(dx) < 3) continue;
    const d = Math.sign(dx);
    if (dir && d !== dir) reversals++;
    dir = d;
  }
  if (reversals >= 3 && now - stroke.lastPetAt > 5000 && overHead(e.clientX, e.clientY)) {
    stroke.lastPetAt = now; stroke.xs = [];
    wants?.petted();
    behaviour.pet();
    if (Math.random() < 0.45) speak(line(sim.variant, wants?.warm ? "pettedWarm" : "petted", { name: ownerName() }), { ttlMs: 4000 });
  }
}

// ── Skins ───────────────────────────────────────────────────────────────
function setVariant(name) {
  sim.setVariant(name);
  sim.syncRig();
  applySkin(sim.rig, name);
  pet.setVariant(name);
}
let appConfig = { name: "" };
function applyConfig(cfg) {
  appConfig = { name: cfg.name || "" };
  if (cfg.variant) setVariant(cfg.variant);
}

// ── Chat ────────────────────────────────────────────────────────────────
function openChat() {
  behaviour.setChatting(true);
  bubble.prompt();
  pet?.focus();
}
function closeChat() {
  bubble.hide();
  behaviour.setChatting(false);
  updateMouseGate();
}
const ACTION_TAG = new RegExp(String.raw`\[(sit|stand|roll|peck|quack|dance|come|sleep|nap(?:\s+\d+\s*[smh]?)?|hop|off|skate|walk|ball|noball|kick|quiet|loud|mail|focus\s+\d+|remind\s+[^\]]+|color\s+(${variantNames().join("|")}))\]`, "gi");
async function setReminder(spec) {
  const r = await pet.remind(spec);
  if (r) speak(`Noted: ${r.label}, ${r.text}.`, { ttlMs: 7000 });
  else speak("I couldn't make out the time for that reminder. Try 'at 3' or 'in 20 minutes'.", { ttlMs: 8000 });
}
function runBodyAction(tag) {
  if (/^remind\s/i.test(tag)) { setReminder(tag.replace(/^remind\s+/i, "")); return; }
  const [verb, arg] = tag.toLowerCase().split(/\s+/);
  switch (verb) {
    case "sit": behaviour.sit(); break;
    case "stand": behaviour.stand(); break;
    case "roll": behaviour.roll(); break;
    case "peck": behaviour.pick(); break;
    case "quack": behaviour.quack(); break;
    case "dance": behaviour.dance(); break;
    case "hop": behaviour.hop(); break;
    case "skate": behaviour.setLoco("rollers"); break;
    case "walk": behaviour.setLoco("legs"); break;
    case "off": behaviour.stepOff(); break;
    case "sleep": behaviour.sleep(); break;
    case "ball": if (!sim.ballActive) sim.spawnBall(); break;
    case "noball": sim.parkBall(); break;
    case "kick": behaviour.kickNow(); break;
    case "quiet": pet.setQuiet(true); break;
    case "loud": pet.setQuiet(false); break;
    case "nap": startNap(napMs(tag.slice(3))); break;
    case "mail": pet.mail(wants?.describe() ?? ""); break;
    case "focus": pet.focus(Number(arg) || 25); break;
    case "come": { const x = behaviour.cursorX ?? (cursorPx ? screenToWorld(cursorPx.x, innerHeight - 20).x : null); if (x !== null) behaviour.goTo(x); break; }
    case "color": setVariant(arg); break;
  }
}
// When the brain forgets its tag, plain body requests still get obeyed.
const IMPLIED = [
  [/\b(sit|take a seat|sit down|lie down)\b/i, "sit"],
  [/\b(stand( up)?|get up)\b/i, "stand"],
  [/\bdanc(e|ing)\b|\bwiggle\b/i, "dance"],
  [/\broll( over)?\b|somersault|\bflip\b/i, "roll"],
  [/\bpeck\b|pick (something )?up/i, "peck"],
  [/\bquack\b/i, "quack"],
  [/\bcome (here|over|to me)\b/i, "come"],
  [/\b(go to )?sleep\b|\bnap\b/i, "sleep"],
  [/\b(jump|hop|climb)( up)?\b|get on (the|that|my)/i, "hop"],
  [/\b(get|jump|hop|come) (down|off)\b/i, "off"],
  [/\b(skate|skating|roller|rollers|wheels)\b/i, "skate"],
  [/\b(play|fetch|football|soccer)\b|\bball\b(?!.*\b(away|gone|remove)\b)/i, "ball"],
  [/\b(put|take) .*ball away\b|\bno more ball\b|\bremove the ball\b/i, "noball"],
  [/\bkick\b/i, "kick"],
  [/\b(be quiet|quiet mode|hush|shush|mute|silence|no (more )?(sound|noise|talking))\b/i, "quiet"],
  [/\b(unmute|sound(s)? (back )?on|speak up|loud mode|talk again|you can talk)\b/i, "loud"],
  [/\b(any (new )?(mail|e-?mail|letters|post|messages)|my briefing|morning briefing|catch me up|what('s| is) (new|up) today|what did i miss)\b/i, "mail"],
  [/\b(take a nap|have a nap|nap time|go (and )?nap)\b/i, "nap"],
  [/\b(legs back|back on (your )?legs|stop skating|take (the )?(skates|wheels) off|walk(ing)? mode)\b/i, "walk"],
];
function impliedBodyActions(request) {
  const out = IMPLIED.filter(([re]) => re.test(request)).map(([, verb]) => verb);
  if (/\bremind\b|\breminder\b/i.test(request)) out.push(`remind ${request}`);
  const focus = /\bfocus\b.*?\b(\d{1,3})\s*(min|minutes?|m\b)/i.exec(request) ?? /\b(\d{1,3})\s*(?:min|minutes?)\b.*\bfocus\b/i.exec(request);
  if (focus) out.push(`focus ${focus[1]}`);
  else if (/\b(focus (mode|time|block)|heads down|do not disturb|don't disturb)\b/i.test(request)) out.push("focus 25");
  if (/\b(stop|end|done) (the )?focus(ing)?\b|\bfocus (off|over|done)\b/i.test(request)) out.push("focus 0");
  const aliases = variantAliases();
  const colour = new RegExp(`\\b(${[...variantNames(), ...Object.keys(aliases)].join("|")})\\b`, "i").exec(request);
  if (colour && /\b(colou?r|outfit|paint|turn)\b/i.test(request)) out.push(`color ${aliases[colour[1].toLowerCase()] ?? colour[1].toLowerCase()}`);
  return out;
}
async function ask(text) {
  behaviour.setChatting(true);
  bubble.thinking();
  wants?.chatted();
  const context = [wants?.describe(), behaviour.focus ? "You are in a focus block." : "", presence.weekend ? "It is the weekend." : ""].filter(Boolean).join(" ");
  const res = await pet.ask(text, context);
  const raw = (res?.text || "").trim() || (res?.error ? `quack… (${res.error})` : "quack?");
  let actions = [...raw.matchAll(ACTION_TAG)].map((m) => m[1]);
  if (!actions.length) actions = impliedBodyActions(text);
  else if (!actions.some((a) => /^remind/i.test(a))) actions.push(...impliedBodyActions(text).filter((a) => /^remind/i.test(a)));
  const timedNap = napFromRequest(text);
  if (timedNap && !actions.some((a) => /^nap\s+\d/i.test(a))) actions = [...actions.filter((a) => !/^(sleep|nap)$/i.test(a)), timedNap];
  const reply = raw.replace(ACTION_TAG, "").replace(/\s{2,}/g, " ").trim() || "quack!";
  bubble.show(reply, { ttlMs: Math.min(30000, 4000 + reply.length * 60) });
  audio.chirp(sim.variant);
  for (const a of actions) runBodyAction(a);
  if (!audio.muted) pet.say(reply);
  else behaviour.setChatting(false);
}
pet?.onSpeaking((v) => {
  behaviour.setSpeaking(v);
  if (!v) behaviour.setChatting(bubble.hasInput);
});
function handleCommand(cmd) {
  switch (cmd.type) {
    case "chat": if (bubble.isPrompting()) closeChat(); else openChat(); break;
    case "listen": toggleListening(); break;
    case "sit": behaviour.sit(); break;
    case "stand": behaviour.stand(); break;
    case "roll": behaviour.roll(); break;
    case "pick": behaviour.pick(); break;
    case "quack": behaviour.quack(); break;
    case "sleep": behaviour.sleep(); break;
    case "reset": sim.reset(); behaviour.onDropped(); break;
    case "mute": audio.setMuted(cmd.value); break;
    case "variant": setVariant(cmd.value); break;
    case "config": applyConfig(cmd); break;
    case "say": bubble.show(cmd.value, { ttlMs: 8000 }); pet.say(cmd.value); break;
    case "nudge": nudge(cmd); break;
    case "mood": {
      const video = cmd.video ? { ...cmd.video, worldX: screenToWorld(cmd.video.x, cmd.video.y).x } : null;
      behaviour.setMood({ music: cmd.music, call: cmd.call, video });
      audio.setHush(!!cmd.call);
      if (cmd.call) pet?.stopSpeaking();
      break;
    }
    case "goto": behaviour.goTo(screenToWorld(cmd.x, innerHeight - 20).x); break;
    case "ball": sim.ballActive ? sim.parkBall() : sim.spawnBall(cursorPx ? screenToWorld(cursorPx.x, cursorPx.y).x : null); break;
    case "skate": behaviour.setLoco("rollers"); break;
    case "walk": behaviour.setLoco("legs"); break;
    case "kick": behaviour.kickNow(); break;
    case "quiet": pet.setQuiet(true); break;
    case "loud": pet.setQuiet(false); break;
    case "presence": onPresence(cmd); break;
    case "front": if (!behaviour.engaged) behaviour.glance(screenToWorld(cmd.x, cmd.y).x); break;
    case "settings": settings = { pet: { ...settings.pet, ...(cmd.pet ?? {}) }, work: { ...settings.work, ...(cmd.work ?? {}) } }; if (!wants) ensureWants(cmd.wants ?? null); break;
    case "focus": {
      behaviour.setFocus(cmd.minutes > 0);
      if (cmd.minutes > 0) speak(line(sim.variant, "focusStart", { name: ownerName(), min: cmd.minutes }), { ttlMs: 7000 });
      break;
    }
  }
}
pet?.onCommand(handleCommand);
setTimeout(() => ensureWants(null), 4000);

// ── Voice: push-to-talk (global hotkey or menu), local whisper ──────────
let listening = false;
let micLevel = 0;
const recorder = createRecorder({
  onLevel: (rms) => { micLevel = rms; },
  onAutoStop: () => stopListening(),
});
async function startListening() {
  if (listening) return;
  pet?.stopSpeaking();
  listening = true;
  behaviour.setListening(true);
  bubble.show("listening…", { ttlMs: 0 });
  updateMouseGate();
  try {
    await recorder.start();
    audio.chirp(sim.variant);
  } catch (e) {
    listening = false;
    behaviour.setListening(false);
    bubble.show(`quack… no microphone (${e.message})`, { ttlMs: 6000 });
    log("mic failed", e.message);
  }
}
async function stopListening() {
  if (!listening) return;
  listening = false;
  behaviour.setListening(false);
  const wav = recorder.stop();
  if (!wav) { bubble.show("quack? I didn't hear anything", { ttlMs: 4000 }); behaviour.setChatting(false); return; }
  bubble.thinking();
  const res = await pet.transcribe(wav);
  const heard = (res?.text || "").trim();
  if (!heard) { bubble.show(res?.error ? `quack… (${res.error})` : "quack? say that again", { ttlMs: 5000 }); behaviour.setChatting(false); return; }
  bubble.show(`“${heard}”`, { ttlMs: 0 });
  await ask(heard);
}
function toggleListening() { listening ? stopListening() : startListening(); }

// ── Frame loop ──────────────────────────────────────────────────────────
let asleep = false;
let last = performance.now();
let frameNo = 0;
function renderOnce() {
  sim.syncRig();
  const p = sim.getPose();
  audio.setWheee(sim.loco === "rollers" && p.speed > 0.3, sim.variant);
  const sup = sim.getSupport();
  shadow.position.set(p.x, sup.z + 0.002, -p.y);
  shadow.material.opacity = THREE.MathUtils.clamp(1.4 - (p.z - sup.z) * 4, 0.2, 1);
  const b = sim.getBall();
  ball.visible = ballShadow.visible = !!b;
  if (b) {
    ball.position.set(b.x, b.z, -b.y);
    ball.quaternion.set(b.quat[1], b.quat[2], b.quat[3], b.quat[0]);
    ball.quaternion.premultiply(Q_MJCF_TO_THREE);
    ballShadow.position.set(b.x, 0.003, -b.y);
    ballShadow.material.opacity = THREE.MathUtils.clamp(1.2 - (b.z - 0.05) * 3, 0.1, 0.8);
  }
  const d = duckScreen();
  bubble.setAnchor(d.x, d.y - 0.2 * PX_PER_M);
  placeView();
  renderer.render(scene, viewCam);
}
// Idle throttle: a standing duck with nobody around redraws at a third of
// the display rate (physics keeps its own 50 Hz loop), full rate otherwise.
function renderDivisor() {
  const pose = sim.getPose();
  const busy = pose.speed > 0.03 || grabbing || bubble.open || listening || sim.mode !== "walk" || sim.recovering || behaviour.engaged;
  if (busy) return 1;
  return sim.sitting ? 4 : 3;
}
// While the physics dozes (standing still, nobody near) one frame is drawn and
// then nothing until something moves again.
let dozeDrawn = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  behaviour.update(dt, now);
  wantsTick(dt);
  if (listening && frameNo % 6 === 0) bubble.setLevel(micLevel);
  if (sim.paused && !asleep) {
    if (!dozeDrawn) { renderOnce(); dozeDrawn = true; }
  } else {
    dozeDrawn = false;
    if (frameNo % renderDivisor() === 0) renderOnce();
  }
  frameNo++;
  if (!asleep) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
pet?.setIgnoreMouse(true);
gateOpen = false;


window.duck = { sim, behaviour, bubble, audio, scene, camera, renderer, THREE, ask, duckScreen, startListening, stopListening, computeLedges, handleCommand, get wants() { return wants; }, get windows() { return lastWindows; } };

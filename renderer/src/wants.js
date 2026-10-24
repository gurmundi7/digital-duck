// Three simple meters give the pet wants of its own: energy (naps when low),
// boredom (bids for attention, then sulks) and affection (grows with petting
// and chat, fades over days). Values are 0..1 and persist across launches.
const DAY = 86400000;

export function createWants({ initial, onSave }) {
  const w = { energy: 0.8, boredom: 0.2, affection: 0.4, pets: 0, petsDay: "", lastSaved: 0, ...(initial ?? {}) };
  if (initial?.savedAt) {
    // Rest while the app was closed; affection fades a little per day away.
    const hours = Math.min(48, (Date.now() - initial.savedAt) / 3600000);
    w.energy = Math.min(1, w.energy + hours * 0.08);
    w.boredom = Math.max(0, w.boredom - hours * 0.1);
    w.affection = Math.max(0.1, w.affection - (hours / 24) * 0.06);
  }
  const today = () => new Date().toDateString();
  if (w.petsDay !== today()) { w.petsDay = today(); w.pets = 0; }
  const clamp = (v) => Math.min(1, Math.max(0, v));
  let sinceSave = 0;
  const events = [];

  // dt in seconds. ctx: { asleep, sitting, moving, engaged, ownerPresent, hour, weekend }
  function update(dt, ctx) {
    const late = ctx.hour >= 22 || ctx.hour < 6;
    const drain = ctx.asleep ? -0.012 : ctx.sitting ? -0.002 : ctx.moving ? 0.0028 : 0.0012;
    w.energy = clamp(w.energy - (drain * (late ? 1.6 : 1)) * dt / 60 * 10);
    if (ctx.engaged) w.boredom = clamp(w.boredom - 0.02 * dt);
    else if (ctx.ownerPresent && !ctx.asleep) w.boredom = clamp(w.boredom + (ctx.weekend ? 0.0006 : 0.0011) * dt);
    else w.boredom = clamp(w.boredom - 0.001 * dt);
    w.affection = clamp(w.affection - (0.05 / DAY) * dt * 1000);
    sinceSave += dt;
    if (sinceSave > 60) { sinceSave = 0; save(); }
  }
  function save() { onSave?.({ ...w, savedAt: Date.now() }); }
  function petted() { w.affection = clamp(w.affection + 0.06); w.boredom = clamp(w.boredom - 0.25); if (w.petsDay !== today()) { w.petsDay = today(); w.pets = 0; } w.pets++; save(); }
  function chatted() { w.affection = clamp(w.affection + 0.02); w.boredom = clamp(w.boredom - 0.3); }
  function played() { w.boredom = clamp(w.boredom - 0.4); w.energy = clamp(w.energy - 0.05); }
  function napped(minutes) { w.energy = clamp(w.energy + minutes * 0.02); }
  const tier = (v, lo, hi) => (v < lo ? "low" : v > hi ? "high" : "mid");
  function describe() {
    const bits = [];
    const e = tier(w.energy, 0.3, 0.75), b = tier(w.boredom, 0.3, 0.7), a = tier(w.affection, 0.35, 0.7);
    bits.push(e === "low" ? "you are tired and could use a nap" : e === "high" ? "you are full of energy" : "your energy is fine");
    if (b === "high") bits.push("you are bored and want attention"); else if (b === "low") bits.push("you feel entertained");
    bits.push(a === "high" ? "you adore your owner" : a === "low" ? "you feel a little neglected lately" : "you are fond of your owner");
    if (w.pets) bits.push(`you were petted ${w.pets} time${w.pets === 1 ? "" : "s"} today`);
    return `How you feel: ${bits.join(", ")}.`;
  }
  return {
    update, petted, chatted, played, napped, describe, save,
    debugSet(o) { Object.assign(w, o); },
    get energy() { return w.energy; }, get boredom() { return w.boredom; }, get affection() { return w.affection; },
    get pets() { return w.pets; },
    get sleepy() { return w.energy < 0.22; },
    get bored() { return w.boredom > 0.72; },
    get sulky() { return w.boredom > 0.92; },
    get warm() { return w.affection > 0.65; },
  };
}

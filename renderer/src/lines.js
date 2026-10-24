// What the pet says on its own. {name} is the owner's name. A private skin
// can bring its own set; missing keys fall back to the duck's.
import { skin } from "./skins.js";

const pick = (arr) => arr[(Math.random() * arr.length) | 0];

const LINES = {
  duck: {
    launch: ["Quack. I'm up, {name}.", "Morning shift. Quack.", "Reporting for duck-ty."],
    unlock: ["Oh hi {name}!", "You're back. Quack.", "There you are."],
    backShort: ["Welcome back.", "Quick one. Quack.", "Missed you for a bit."],
    backLong: ["{name}! That was ages. Quack quack.", "You were gone {min} minutes. I counted.", "Back at last. I kept the desk warm."],
    morning: ["Good morning, {name}.", "Morning! Coffee first, then quack."],
    evening: ["Evening, {name}. Still going?", "Late shift, is it?"],
    late: ["It's late, {name}. Even ducks sleep.", "Yawn. Big day tomorrow?"],
    weekend: ["Weekend and you're here? Quack.", "Lazy day. I approve."],
    bored: ["Psst. Bored duck here.", "Anything for me to do? Anything?", "I could do a trick. Watch. Or not.", "Quaaack. Hello?"],
    sulk: ["Fine. I'll sit over here.", "Not that anyone noticed me."],
    petted: ["Quack! Yes, there.", "Hehe. More.", "That's the spot."],
    pettedWarm: ["Best owner. Quack.", "I'd follow you anywhere. Slowly."],
    nap: ["Quick nap. Wake me if the building burns.", "Zzz… five minutes."],
    napEnd: ["Hm? I'm awake. I was awake.", "Nap done. Ready."],
    deliver: ["A message for you:", "Hey {name}:", "Psst:"],
    focusStart: ["Heads down for {min} minutes. I'll keep quiet.", "Focus time. Not a quack from me."],
  },
};

export function line(variant, key, vars = {}) {
  const set = skin(variant)?.lines ?? LINES.duck;
  const raw = pick(set[key] ?? LINES.duck[key] ?? [""]);
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

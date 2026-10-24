// Skins beyond Pollen's colourways come from an optional private/ folder at the
// repo root (gitignored): skins.json holds labels, aliases and lines, skins.js
// exports register({ THREE, VARIANTS, VARIANT_LABELS, VARIANT_SWATCH_HEX })
// returning { name: { apply(rig), undress(rig), chirp({ ctx, out }) } }.
// THREE is handed in so the pack never loads a second copy.
import * as THREE from "three";
import { VARIANTS, VARIANT_LABELS, VARIANT_SWATCH_HEX } from "../../sim/src/game/variants.js";

const data = Object.values(import.meta.glob("../../private/skins.json", { eager: true, import: "default" }))[0] ?? {};
const code = Object.values(import.meta.glob("../../private/skins.js", { eager: true }))[0];
const hooks = code?.register?.({ THREE, VARIANTS, VARIANT_LABELS, VARIANT_SWATCH_HEX }) ?? {};

export const skin = (name) => (data[name] || hooks[name] ? { ...data[name], ...hooks[name] } : null);
export const variantNames = () => Object.keys(VARIANTS);
// Chat words that pick a skin: its own name plus the aliases in skins.json.
export function variantAliases() {
  const out = { cream: "classic" };
  for (const [name, d] of Object.entries(data)) for (const a of d.aliases ?? []) out[a] = name;
  return out;
}

export function applySkin(rig, name) {
  undress(rig);
  const s = hooks[name];
  if (!s?.apply) return;
  s.apply(rig);
  rig.userData = { ...(rig.userData ?? {}), skinName: name };
}
export function undress(rig) {
  const name = rig.userData?.skinName;
  if (!name) return;
  hooks[name]?.undress?.(rig);
  delete rig.userData.skinName;
}

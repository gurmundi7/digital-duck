import * as THREE from "three";

// Music notes that float up from the duck's head while music plays: one every few
// seconds, never a stream. Visual only, like the headphones.
const GLYPHS = ["♪", "♫"];
const LIFE_S = 2.6, RISE_M = 0.12, SIZE_M = 0.06;

function glyphTexture(glyph) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.font = "bold 104px -apple-system, 'Apple Symbols', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 10;
  g.strokeStyle = "#1b1c20";
  g.strokeText(glyph, 64, 70);
  g.fillStyle = "#ff8a3d";
  g.fillText(glyph, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createNotes(scene, { random = Math.random } = {}) {
  const textures = GLYPHS.map(glyphTexture);
  const live = [];
  let wait = 0.6;

  function spawn(at) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures[(random() * textures.length) | 0], transparent: true, depthWrite: false, opacity: 0 }));
    sprite.scale.set(SIZE_M, SIZE_M, 1);
    const side = random() < 0.5 ? -1 : 1;
    live.push({ sprite, age: 0, x: at.x + side * (0.02 + 0.03 * random()), y: at.y + 0.015, z: at.z, drift: side * (0.02 + 0.03 * random()), phase: random() * Math.PI * 2 });
    scene.add(sprite);
  }

  // on: music is playing and the duck is awake; at: the head's world position.
  function update(dt, { on, at }) {
    if (on && at) {
      wait -= dt;
      if (wait <= 0) { spawn(at); wait = 3 + 2 * random(); }
    } else wait = 0.6;
    for (let i = live.length - 1; i >= 0; i--) {
      const n = live[i];
      n.age += dt;
      const k = n.age / LIFE_S;
      if (k >= 1) { scene.remove(n.sprite); n.sprite.material.dispose(); live.splice(i, 1); continue; }
      n.sprite.position.set(n.x + n.drift * k + 0.012 * Math.sin(n.phase + n.age * 5), n.y + RISE_M * k, n.z);
      n.sprite.material.opacity = Math.min(1, n.age / 0.3, (1 - k) / 0.35);
      n.sprite.material.rotation = 0.25 * Math.sin(n.phase + n.age * 3);
    }
  }

  return { update, get count() { return live.length; } };
}

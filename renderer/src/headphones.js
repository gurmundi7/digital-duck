import * as THREE from "three";

// Headphones the duck wears on a call: a band over the crown and a cup over
// each side of the head. Visual only, physics never sees them. They are sized
// from the head shells and parented to the head body, so they follow every nod.
const HEAD_BODY = "jaw_soft";
const SHELLS = new Set(["top_head_shell.stl", "bottom_head_shell.stl"]);

const band = new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.45, metalness: 0.2 });
const cushion = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.95 });
const cap = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.4 });

// Call right after buildRig, while the rig is in its rest pose: placer space
// then faces +X with +Y up, so the ears lie along Z.
export function addHeadphones(rig) {
  const head = rig.bodies.get(HEAD_BODY);
  if (!head) return null;
  rig.placer.updateWorldMatrix(true, true);
  const toPlacer = rig.placer.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  head.traverse((o) => {
    if (!o.isMesh || !SHELLS.has(o.userData.meshName)) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(toPlacer.clone().multiply(o.matrixWorld)));
  });
  if (box.isEmpty()) return null;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());

  const cupR = 0.32 * s.y, cupDepth = 0.14 * s.z;
  const cupX = c.x - 0.08 * s.x, cupY = c.y + 0.02 * s.y;
  const sideZ = s.z / 2 + cupDepth / 2 - 0.1 * cupDepth;
  const phones = new THREE.Group();
  phones.name = "headphones";

  const rz = sideZ, ry = box.max.y + 0.08 * s.y - cupY;
  const arc = new THREE.Mesh(new THREE.TorusGeometry(rz, 0.07 * s.y, 12, 48, Math.PI), band);
  arc.rotation.y = Math.PI / 2;
  arc.scale.set(1, ry / rz, 1);
  arc.position.set(cupX, cupY, c.z);
  phones.add(arc);

  for (const side of [-1, 1]) {
    const cup = new THREE.Group();
    cup.position.set(cupX, cupY, c.z + side * sideZ);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(cupR, cupR * 0.92, cupDepth, 28), band);
    shell.rotation.x = side * Math.PI / 2;
    const pad = new THREE.Mesh(new THREE.TorusGeometry(cupR * 0.82, cupR * 0.22, 10, 28), cushion);
    pad.position.z = -side * cupDepth / 2;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(cupR * 0.55, 28), cap);
    dot.position.z = side * (cupDepth / 2 + 0.0005);
    dot.rotation.y = side > 0 ? 0 : Math.PI;
    cup.add(shell, pad, dot);
    phones.add(cup);
  }

  // Built in placer space; re-express in the head body's frame and hang it there.
  const headInPlacer = toPlacer.clone().multiply(head.matrixWorld);
  phones.applyMatrix4(headInPlacer.invert());
  phones.visible = false;
  for (const o of phones.children) o.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  head.add(phones);
  return phones;
}

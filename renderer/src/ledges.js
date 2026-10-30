// MuJoCo's broadphase reads geom_aabb, not geom_size, so a ledge widened at
// runtime must update all three or bodies past the compiled width fall through.
export function sizeLedge(model, g, halfW, halfD, halfT) {
  model.geom_size[g * 3] = halfW;
  model.geom_rbound[g] = Math.hypot(halfW, halfD, halfT);
  model.geom_aabb[g * 6 + 3] = halfW;
}

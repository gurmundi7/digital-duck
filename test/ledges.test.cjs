const test = require("node:test");
const assert = require("node:assert");

// The same ledge pet-sim compiles: 0.3 m half-width, widened per window at runtime.
const XML = `<mujoco><option timestep="0.002"/><worldbody>
<body name="plat" mocap="true" pos="0 0 -5"><geom name="plat_geom" type="box" size="0.3 0.5 0.03"/></body>
<body name="ball" pos="0.8 0 0.3"><freejoint/><geom type="sphere" size="0.03" mass="0.05"/></body>
</worldbody></mujoco>`;

test("a widened ledge holds a body past its compiled width", async () => {
  const { default: load } = await import("@mujoco/mujoco");
  const { sizeLedge } = await import("../renderer/src/ledges.js");
  const mujoco = await load();
  const model = mujoco.MjModel.from_xml_string(XML);
  const data = new mujoco.MjData(model);
  const g = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM.value, "plat_geom");
  sizeLedge(model, g, 1.0, 0.5, 0.03);
  data.mocap_pos[2] = 0.17;
  for (let i = 0; i < 1000; i++) mujoco.mj_step(model, data);
  assert.ok(Math.abs(data.qpos[2] - 0.23) < 0.01, `ball at z ${data.qpos[2]}, expected resting on the ledge at 0.23`);
});

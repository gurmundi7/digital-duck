// Lean Microduck core for the desktop pet: MuJoCo WASM physics, the official
// ONNX policies at 50 Hz, fall recovery, sit/stand, roll and ground pick.
// Derived from pollen-robotics/microduck-simulator (Apache 2.0); the arena,
// ball, multiplayer and UI layers are left out.
import * as THREE from "three";
import mujocoWasmUrl from "@mujoco/mujoco/mujoco.wasm?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import {
  loadKinematics, loadGlbGeometries, geometryToBinaryStl, buildRig, setJoint, setJawOpen, MODEL_DIR,
} from "../../sim/src/game/duck.js";
import {
  POLICIES, JOINT_NAMES, DEFAULT_POSE, NUM_JOINTS, OBS_SIZE, CMD_SIZE, ACTION_SCALE,
  TIMESTEP, DECIMATION, CTRL_DT, GROUND_PICK_PERIOD_S, GROUND_PICK_END_PHASE,
  CROUCH_PERIOD_S, CROUCH_END_PHASE, VEL_FWD, VEL_BACK, VEL_ANG, RVEL_FWD, RVEL_BACK, RVEL_ANG,
} from "../../sim/src/game/constants.js";
import { VARIANTS, DEFAULT_VARIANT, materialHookFor, applyVariant } from "../../sim/src/game/variants.js";
import { addHeadphones } from "./headphones.js";
import { sizeLedge } from "./ledges.js";

const HEAD_ALPHA = 0.2;
const FALL_DEBOUNCE_STEPS = 10;
const FALL_SETTLE_STEPS = 15;
const RECOVER_UPRIGHT_STEPS = 50;
const RECOVER_GIVEUP_STEPS = 300;
const GRAB_STIFFNESS = 100;
const GRAB_DAMPING = Math.sqrt(GRAB_STIFFNESS);
const GRAB_MAX_ACC = 200;
const STEP_LIFT = 0.012;
const STEP_CONTACT = 0.005;
const STEP_DEBOUNCE_MS = 130;
const PLATFORMS = 8;
const PLAT_HALF_T = 0.03;
const BALL_RADIUS = 0.05;
const BALL_PARK = "50 0 0.05";
const KICK_STEPS = 25;
const POST_KICK_LOCK_STEPS = 20;

export const duckYaw = (qpos) => Math.atan2(
  2 * (qpos[3] * qpos[6] + qpos[4] * qpos[5]),
  1 - 2 * (qpos[5] * qpos[5] + qpos[6] * qpos[6]),
);

export async function createPetSim({ halfX, halfY, variant = DEFAULT_VARIANT, onFootstep = () => {}, onLog = () => {} }) {
  const [{ default: loadMujocoFactory }, ort] = await Promise.all([
    import("@mujoco/mujoco"),
    import("onnxruntime-web/wasm"),
  ]);
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  ort.env.wasm.numThreads = 1;

  async function buildPhysicsXml(xmlFile) {
    const src = await (await fetch(`${MODEL_DIR}/${xmlFile}`)).text();
    const doc = new DOMParser().parseFromString(src, "text/xml");
    for (const g of [...doc.querySelectorAll('geom[class="visual"]')]) g.remove();
    const usedMeshes = new Set([...doc.querySelectorAll("geom[mesh]")].map((g) => g.getAttribute("mesh")));
    for (const m of [...doc.querySelectorAll("asset > mesh")]) {
      const name = m.getAttribute("name") ?? m.getAttribute("file").replace(/\.stl$/i, "");
      if (!usedMeshes.has(name)) m.remove();
    }
    const root = doc.documentElement;
    const el = (tag, attrs) => {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };
    root.appendChild(el("option", { timestep: String(TIMESTEP) }));
    const world = doc.querySelector("worldbody");
    world.appendChild(el("geom", { name: "floor", type: "plane", size: "0 0 0.05", pos: "0 0 0" }));
    // Invisible fence: the duck stays inside the window, at any height.
    const ht = 0.025, hh = 0.9;
    const walls = [
      { name: "wall_px", pos: `${halfX + ht} 0 ${hh}`, size: `${ht} ${halfY + 0.1} ${hh}` },
      { name: "wall_nx", pos: `${-halfX - ht} 0 ${hh}`, size: `${ht} ${halfY + 0.1} ${hh}` },
      { name: "wall_py", pos: `0 ${halfY + ht} ${hh}`, size: `${halfX + 0.1} ${ht} ${hh}` },
      { name: "wall_ny", pos: `0 ${-halfY - ht} ${hh}`, size: `${halfX + 0.1} ${ht} ${hh}` },
    ];
    for (const w of walls) world.appendChild(el("geom", { name: w.name, type: "box", pos: w.pos, size: w.size }));
    // Window ledges: mocap boxes parked below the floor until a window top edge claims one.
    for (let i = 0; i < PLATFORMS; i++) {
      const body = el("body", { name: `plat${i}`, mocap: "true", pos: "0 0 -5" });
      body.appendChild(el("geom", { name: `plat${i}_geom`, type: "box", size: `0.3 ${halfY + 0.1} ${PLAT_HALF_T}`, friction: "1 0.005 0.0001" }));
      world.appendChild(body);
    }
    const poseByName = new Map(JOINT_NAMES.map((n, i) => [n, DEFAULT_POSE[i]]));
    const qposJoints = [...doc.querySelectorAll("body > joint")]
      .map((j) => poseByName.get(j.getAttribute("name")) ?? 0)
      .join(" ");
    // Kickable beach ball, parked far away until spawned. Appended after the
    // robot so the trunk freejoint stays first in qpos.
    const ballBody = el("body", { name: "ball", pos: BALL_PARK });
    ballBody.appendChild(el("freejoint", { name: "ball_freejoint" }));
    ballBody.appendChild(el("geom", { name: "ball_geom", type: "sphere", size: String(BALL_RADIUS), mass: "0.03", friction: "0.4 0.01 0.003", solref: "0.03 0.4", condim: "6" }));
    world.appendChild(ballBody);
    const kf = doc.createElement("keyframe");
    kf.appendChild(el("key", {
      name: "STAND",
      qpos: `0 0 0.12 1 0 0 0 ${qposJoints} ${BALL_PARK} 1 0 0 0`,
      ctrl: Array.from(DEFAULT_POSE).join(" "),
    }));
    root.appendChild(kf);
    const meshFiles = [...doc.querySelectorAll("asset > mesh")].map((m) => m.getAttribute("file"));
    return { xml: new XMLSerializer().serializeToString(doc), meshFiles };
  }

  onLog("loading physics, model and policies");
  const [mujoco, { xml, meshFiles }, kin] = await Promise.all([
    loadMujocoFactory({ locateFile: (p) => (p.endsWith(".wasm") ? mujocoWasmUrl : p) }),
    buildPhysicsXml("robot_allcollisions.xml"),
    loadKinematics(`${MODEL_DIR}/kinematics.json`),
  ]);

  const vfs = new mujoco.MjVFS();
  const vfsFiles = new Set();
  async function addMeshesToVfs(files) {
    const geoms = await loadGlbGeometries();
    await Promise.all(files.map(async (f) => {
      if (vfsFiles.has(f)) return;
      vfsFiles.add(f);
      const entry = geoms.get(f);
      const buf = entry
        ? geometryToBinaryStl(entry.welded)
        : await (await fetch(`${MODEL_DIR}/meshes/${f}`)).arrayBuffer();
      vfs.addBuffer(`assets/${f}`, new Uint8Array(buf));
    }));
  }
  await addMeshesToVfs(meshFiles);

  let currentVariant = variant;
  const rigPromise = buildRig(kin, { materialForMesh: materialHookFor(VARIANTS[currentVariant]) });
  const sessionOpts = { executionProviders: ["wasm"] };
  const [walkS, sitstandS, rollS, groundpickS, standS] = await Promise.all(
    [POLICIES.walk, POLICIES.sitstand, POLICIES.roll, POLICIES.groundpick, POLICIES.stand]
      .map((url) => ort.InferenceSession.create(url, sessionOpts)),
  );
  const sessions = { walk: walkS, sitstand: sitstandS, roll: rollS, groundpick: groundpickS, stand: standS };

  // Two locomotion variants share the policies' joint layout; each keeps its
  // own compiled model, data, render rig and resolved addresses.
  const JOINT_SET = new Set(JOINT_NAMES);
  function resolveAddrs(model, k) {
    const id = (type, name) => mujoco.mj_name2id(model, mujoco.mjtObj[type].value, name);
    return {
      qposAdr: JOINT_NAMES.map((n) => model.jnt(n).qposadr),
      dofAdr: JOINT_NAMES.map((n) => model.jnt(n).dofadr),
      gyroAdr: model.sensor("imu_ang_vel").adr,
      trunkId: id("mjOBJ_BODY", "trunk_base"),
      standKeyId: id("mjOBJ_KEY", "STAND"),
      ankleIds: ["ankle_left", "ankle_right"].map((n) => id("mjOBJ_BODY", n)),
      extraJoints: k.bodies
        .filter((b) => b.joint && b.joint.type === "hinge" && !JOINT_SET.has(b.joint.name))
        .map((b) => ({ name: b.joint.name, adr: model.jnt(b.joint.name).qposadr })),
      platGeom: Array.from({ length: PLATFORMS }, (_, i) => id("mjOBJ_GEOM", `plat${i}_geom`)),
      ballQposAdr: model.jnt("ball_freejoint").qposadr,
      ballDofAdr: model.jnt("ball_freejoint").dofadr,
      platMocap: Array.from({ length: PLATFORMS }, (_, i) => model.body_mocapid[id("mjOBJ_BODY", `plat${i}`)]),
    };
  }
  const locos = {};
  {
    const legsModel = mujoco.MjModel.from_xml_string(xml, vfs);
    const legsRig = await rigPromise;
    addHeadphones(legsRig);
    locos.legs = { model: legsModel, data: new mujoco.MjData(legsModel), rig: legsRig, trunkGroup: legsRig.bodies.get("trunk_base"), ...resolveAddrs(legsModel, kin) };
  }
  let loco = "legs";
  let { model, data, rig, trunkGroup, qposAdr, dofAdr, gyroAdr, trunkId, standKeyId, ankleIds, extraJoints, platGeom, platMocap, ballQposAdr, ballDofAdr } = locos.legs;
  const velLimits = () => (loco === "rollers" ? [RVEL_FWD, RVEL_BACK, RVEL_ANG] : [VEL_FWD, VEL_BACK, VEL_ANG]);

  let kicksLoading = null;
  function ensureKicks() {
    kicksLoading ??= Promise.all([
      ort.InferenceSession.create(POLICIES.kickL, sessionOpts),
      ort.InferenceSession.create(POLICIES.kickR, sessionOpts),
    ]).then(([l, r]) => { sessions.kickL = l; sessions.kickR = r; }).catch((e) => { kicksLoading = null; throw e; });
    return kicksLoading;
  }
  let rollersLoading = null;
  function ensureRollers() {
    rollersLoading ??= (async () => {
      const [{ xml: rXml, meshFiles: rMeshFiles }, rk] = await Promise.all([
        buildPhysicsXml("robot_allcollisions_rollers.xml"),
        loadKinematics(`${MODEL_DIR}/kinematics_rollers.json`),
      ]);
      const [rRig, sDrive, sCrouch] = await Promise.all([
        buildRig(rk, { materialForMesh: materialHookFor(VARIANTS[currentVariant]) }),
        ort.InferenceSession.create(POLICIES.drive, sessionOpts),
        ort.InferenceSession.create(POLICIES.crouch, sessionOpts),
        addMeshesToVfs(rMeshFiles),
      ]);
      addHeadphones(rRig);
      sessions.drive = sDrive;
      sessions.crouch = sCrouch;
      const rModel = mujoco.MjModel.from_xml_string(rXml, vfs);
      locos.rollers = { model: rModel, data: new mujoco.MjData(rModel), rig: rRig, trunkGroup: rRig.bodies.get("trunk_base"), ...resolveAddrs(rModel, rk) };
    })().catch((e) => { rollersLoading = null; throw e; });
    return rollersLoading;
  }
  let platforms = []; // [{ x, z (top surface), halfW }] in MJCF metres, at most PLATFORMS
  const platDepth = halfY + 0.1;
  function applyPlatforms() {
    const mp = data.mocap_pos;
    for (let i = 0; i < PLATFORMS; i++) {
      const m = platMocap[i] * 3, g = platGeom[i];
      const pl = platforms[i];
      if (!pl) { mp[m] = 0; mp[m + 1] = 0; mp[m + 2] = -5; continue; }
      sizeLedge(model, g, pl.halfW, platDepth, PLAT_HALF_T);
      mp[m] = pl.x; mp[m + 1] = 0; mp[m + 2] = pl.z - PLAT_HALF_T;
    }
  }

  const lastAction = new Float32Array(NUM_JOINTS);
  const obs = new Float32Array(OBS_SIZE);
  const cmd = new Float32Array(CMD_SIZE);
  const twist = new Float32Array(3); // [vx, 0, wz] requested by the behaviour layer
  const headTarget = new Float32Array(4); // [neck_pitch, head_pitch, head_yaw, head_roll]
  const headSmooth = new Float32Array(4);

  let mode = "walk"; // walk | sitstand | roll | groundpick
  let sitFlag = 0;
  let rollRun = null;
  let pickRun = null;
  let crouchRun = null;
  let kickRun = null;
  let postKickLock = 0;
  let ballActive = false;
  const isKick = () => mode === "kickL" || mode === "kickR";
  let sitTimer = null;
  let standTimer = null;
  let recovery = null; // null | { state: "fallen"|"recovering", steps, uprightSteps }
  let fallDebounce = 0;
  let fallenSince = null;
  let grab = null; // { target: [x, y, z] in MJCF }
  let jawOpen = 0;
  let paused = false;
  let wake = null;
  const listeners = new Set();
  const emit = (ev) => { for (const l of listeners) l(ev); };

  const _q = new THREE.Quaternion();
  const _g = new THREE.Vector3();
  function projGravZ() {
    const xq = data.body(trunkId).xquat;
    _q.set(xq[1], xq[2], xq[3], xq[0]).conjugate();
    _g.set(0, 0, -1).applyQuaternion(_q);
    return _g.z;
  }

  const ZERO = new Float32Array(3);
  const effectiveTwist = () => (mode !== "walk" || recovery || grab || postKickLock > 0 ? ZERO : twist);

  function buildObs() {
    const qpos = data.qpos, qvel = data.qvel, sens = data.sensordata;
    let i = 0;
    for (let a = 0; a < 3; a++) obs[i++] = sens[gyroAdr + a];
    const xq = data.body(trunkId).xquat;
    _q.set(xq[1], xq[2], xq[3], xq[0]).conjugate();
    _g.set(0, 0, -1).applyQuaternion(_q);
    obs[i++] = _g.x; obs[i++] = _g.y; obs[i++] = _g.z;
    for (let j = 0; j < NUM_JOINTS; j++) obs[i++] = qpos[qposAdr[j]] - DEFAULT_POSE[j];
    for (let j = 0; j < NUM_JOINTS; j++) obs[i++] = qvel[dofAdr[j]];
    for (let j = 0; j < NUM_JOINTS; j++) obs[i++] = lastAction[j];
    cmd.fill(0, 0, 3);
    if (mode === "sitstand") {
      cmd[0] = sitFlag;
    } else if ((mode === "groundpick" && pickRun) || (mode === "crouch" && crouchRun)) {
      const a = 2 * Math.PI * (mode === "crouch" ? crouchRun.phase : pickRun.phase);
      cmd[0] = Math.cos(a);
      cmd[1] = Math.sin(a);
    } else {
      const c = effectiveTwist();
      cmd[0] = c[0]; cmd[1] = c[1]; cmd[2] = c[2];
    }
    for (let h = 0; h < 4; h++) headSmooth[h] += HEAD_ALPHA * (headTarget[h] - headSmooth[h]);
    const zeroHead = mode === "groundpick" || recovery !== null;
    for (let h = 0; h < 4; h++) cmd[3 + h] = zeroHead ? 0 : headSmooth[h];
    for (let c = 0; c < CMD_SIZE; c++) obs[i++] = cmd[c];
    return obs;
  }

  const activeSession = () => {
    if (recovery?.state === "recovering") return sessions.stand;
    return sessions[loco === "rollers" && mode === "walk" ? "drive" : mode];
  };

  function poseIsDead() {
    const z = data.qpos[2];
    const gz = projGravZ();
    if (!Number.isFinite(z) || !Number.isFinite(gz)) return "exploded";
    if (gz > -0.5 || z < 0.02) return "fallen";
    return null;
  }

  function applyGrabForce() {
    if (!grab) return;
    const qpos = data.qpos, qvel = data.qvel;
    if (grab.upright) {
      const yaw = grab.yaw ?? duckYaw(qpos);
      qpos[3] = Math.cos(yaw / 2); qpos[4] = 0; qpos[5] = 0; qpos[6] = Math.sin(yaw / 2);
      qvel[3] = 0; qvel[4] = 0; qvel[5] = 0;
    }
    let fx = GRAB_STIFFNESS * (grab.target[0] - qpos[0]) - GRAB_DAMPING * qvel[0];
    let fy = GRAB_STIFFNESS * (grab.target[1] - qpos[1]) - GRAB_DAMPING * qvel[1];
    let fz = GRAB_STIFFNESS * (grab.target[2] - qpos[2]) - GRAB_DAMPING * qvel[2];
    const n = Math.hypot(fx, fy, fz);
    if (n > GRAB_MAX_ACC) { const s = GRAB_MAX_ACC / n; fx *= s; fy *= s; fz *= s; }
    const xfrc = data.xfrc_applied;
    const a = trunkId * 6;
    xfrc[a] = grab.mass * fx; xfrc[a + 1] = grab.mass * fy; xfrc[a + 2] = grab.mass * fz;
  }

  function clearModeTimers() {
    clearTimeout(sitTimer); sitTimer = null;
    clearTimeout(standTimer); standTimer = null;
  }

  function resetSim() {
    endGrab();
    clearModeTimers();
    rollRun = null; pickRun = null; crouchRun = null; kickRun = null; postKickLock = 0; recovery = null;
    ballActive = false;
    fallDebounce = 0; fallenSince = null;
    mode = "walk"; sitFlag = 0;
    headTarget.fill(0); headSmooth.fill(0);
    mujoco.mj_resetDataKeyframe(model, data, standKeyId);
    mujoco.mj_forward(model, data);
    lastAction.fill(0);
    emit({ type: "reset" });
  }

  const stepFeet = [{ air: false, prevZ: 0, lastAt: 0 }, { air: false, prevZ: 0, lastAt: 0 }];
  function detectFootsteps() {
    if (ankleIds[0] < 0 || ankleIds[1] < 0) return;
    const now = performance.now();
    const xpos = data.xpos;
    const zL = xpos[ankleIds[0] * 3 + 2];
    const zR = xpos[ankleIds[1] * 3 + 2];
    const ground = Math.min(zL, zR);
    for (let i = 0; i < 2; i++) {
      const f = stepFeet[i];
      const z = i === 0 ? zL : zR;
      const rel = z - ground;
      const vz = (z - f.prevZ) / CTRL_DT;
      f.prevZ = z;
      if (rel > STEP_LIFT) {
        f.air = true;
      } else if (f.air && rel < STEP_CONTACT && vz < -0.02 && now - f.lastAt > STEP_DEBOUNCE_MS) {
        f.air = false;
        f.lastAt = now;
        onFootstep(Math.min(1, Math.abs(vz) / 0.35));
      }
    }
  }

  async function controlStep() {
    applyPlatforms();
    if (recovery?.state !== "fallen") {
      const session = activeSession();
      const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", buildObs(), [1, OBS_SIZE]) };
      const out = await session.run(feeds);
      const act = out[session.outputNames[0]].data;
      let finite = true;
      for (let j = 0; j < NUM_JOINTS; j++) if (!Number.isFinite(act[j])) { finite = false; break; }
      if (finite) {
        lastAction.set(act);
        const ctrl = data.ctrl;
        for (let j = 0; j < NUM_JOINTS; j++) ctrl[j] = DEFAULT_POSE[j] + act[j] * ACTION_SCALE;
      }
    }
    for (let s = 0; s < DECIMATION; s++) {
      applyGrabForce();
      mujoco.mj_step(model, data);
    }
    if (loco === "legs" && mode === "walk" && !recovery) detectFootsteps();

    const death = poseIsDead();
    if (death === "exploded") {
      resetSim();
    } else if (recovery) {
      recovery.steps++;
      if (recovery.state === "fallen") {
        if (recovery.steps >= FALL_SETTLE_STEPS) {
          recovery = { state: "recovering", steps: 0, uprightSteps: 0 };
          lastAction.fill(0);
        }
      } else {
        recovery.uprightSteps = projGravZ() < -0.85 ? recovery.uprightSteps + 1 : 0;
        if (recovery.uprightSteps >= RECOVER_UPRIGHT_STEPS) {
          recovery = null;
          mode = "walk";
          lastAction.fill(0);
          emit({ type: "recovered" });
        } else if (recovery.steps >= RECOVER_GIVEUP_STEPS) {
          resetSim();
        }
      }
    } else if (death === "fallen") {
      const recoverable = loco === "legs" && mode === "walk" && !standTimer && !grab;
      if (recoverable) {
        fallenSince = null;
        if (++fallDebounce >= FALL_DEBOUNCE_STEPS) {
          fallDebounce = 0;
          recovery = { state: "fallen", steps: 0 };
          emit({ type: "fell" });
        }
      } else if (grab) {
        fallDebounce = 0; fallenSince = null; // held in the air: not a fall
      } else {
        fallDebounce = 0;
        const now = performance.now();
        fallenSince ??= now;
        if (now - fallenSince > (mode === "roll" ? 5000 : 1500)) resetSim();
      }
    } else {
      fallDebounce = 0;
      fallenSince = null;
    }

    if (postKickLock > 0 && mode === "walk") postKickLock--;
    if (isKick() && kickRun) {
      kickRun.steps++;
      if (kickRun.steps >= KICK_STEPS) { kickRun = null; mode = "walk"; postKickLock = POST_KICK_LOCK_STEPS; emit({ type: "idle" }); }
    }
    if (ballActive) {
      const q = data.qpos;
      if (Math.abs(q[ballQposAdr]) > halfX + 0.3 || Math.abs(q[ballQposAdr + 1]) > halfY + 0.3 || q[ballQposAdr + 2] < -0.5) parkBall();
    }
    if (mode === "crouch" && crouchRun) {
      crouchRun.phase += CTRL_DT / CROUCH_PERIOD_S;
      if (crouchRun.phase >= CROUCH_END_PHASE) {
        crouchRun = null;
        mode = "walk";
        emit({ type: "idle" });
      }
    }
    if (mode === "groundpick" && pickRun) {
      pickRun.phase += CTRL_DT / GROUND_PICK_PERIOD_S;
      if (pickRun.phase >= GROUND_PICK_END_PHASE) {
        pickRun = null;
        mode = "walk";
        emit({ type: "idle" });
      }
    }
    if (mode === "roll" && rollRun) {
      rollRun.steps++;
      if (obs[5] > -0.3) rollRun.tipped = true;
      const upright = obs[5] < -0.85;
      const done = rollRun.tipped && upright && rollRun.steps >= 40;
      if (done || rollRun.steps >= 150) {
        rollRun = null;
        mode = "walk";
        lastAction.fill(0);
        if (!upright) resetSim();
        emit({ type: "idle" });
      }
    }
  }

  let ctrlSteps = 0;
  let running = true;
  (async function controlLoop() {
    let next = performance.now();
    while (running) {
      if (paused) {
        await new Promise((r) => { wake = r; });
        wake = null;
        next = performance.now();
      }
      await controlStep();
      ctrlSteps++;
      next += CTRL_DT * 1000;
      const waitMs = next - performance.now();
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      else next = performance.now();
    }
  })();

  function syncRig() {
    const qpos = data.qpos;
    trunkGroup.position.set(qpos[0], qpos[1], qpos[2]);
    trunkGroup.quaternion.set(qpos[4], qpos[5], qpos[6], qpos[3]);
    for (let j = 0; j < NUM_JOINTS; j++) setJoint(rig, JOINT_NAMES[j], qpos[qposAdr[j]]);
    for (const ej of extraJoints) setJoint(rig, ej.name, qpos[ej.adr]);
    setJawOpen(rig, jawOpen);
  }

  // Pollen's sit hand-over: hold the stand under the sitstand policy for a
  // beat before commanding the sit, or the session switch knocks it over.
  function sit() {
    if (loco !== "legs" || recovery || mode !== "walk" || standTimer || grab) return false;
    clearModeTimers();
    mode = "sitstand"; sitFlag = 0; lastAction.fill(0);
    sitTimer = setTimeout(() => { sitTimer = null; if (mode === "sitstand") sitFlag = 1; }, 800);
    return true;
  }
  function stand() {
    if (mode !== "sitstand" || standTimer) return false;
    clearModeTimers();
    sitFlag = 0;
    standTimer = setTimeout(() => {
      standTimer = null;
      mode = "walk";
      lastAction.fill(0);
      emit({ type: "idle" });
    }, 2000);
    return true;
  }
  function doRoll() {
    if (loco === "rollers") return crouch();
    if (recovery || mode !== "walk" || standTimer || grab) return false;
    clearModeTimers();
    mode = "roll"; sitFlag = 0;
    rollRun = { steps: 0, tipped: false };
    return true;
  }
  function crouch() {
    if (loco !== "rollers" || mode !== "walk" || grab || locoSwitching) return false;
    clearModeTimers();
    mode = "crouch";
    crouchRun = { phase: 0 };
    return true;
  }
  let locoSwitching = false;
  function activateLoco(name) {
    const prevRig = rig;
    loco = name;
    ({ model, data, rig, trunkGroup, qposAdr, dofAdr, gyroAdr, trunkId, standKeyId, ankleIds, extraJoints, platGeom, platMocap, ballQposAdr, ballDofAdr } = locos[name]);
    applyVariant(rig, currentVariant);
    showPhones();
    resetSim();
    emit({ type: "rig", rig, prevRig });
  }
  async function setLoco(name) {
    if (name !== "legs" && name !== "rollers") return false;
    if (loco === name || locoSwitching) return false;
    if (rollRun || crouchRun || pickRun || standTimer || recovery || grab) return false;
    locoSwitching = true;
    try {
      if (name === "rollers" && !locos.rollers) await ensureRollers();
      if (paused) setPaused(false);
      activateLoco(name);
      return true;
    } catch (e) {
      onLog(`roller switch failed: ${e?.message ?? e}`);
      return false;
    } finally {
      locoSwitching = false;
    }
  }
  function parkBall() {
    const q = data.qpos, v = data.qvel, b = ballQposAdr;
    q[b] = 50; q[b + 1] = 0; q[b + 2] = BALL_RADIUS; q[b + 3] = 1; q[b + 4] = 0; q[b + 5] = 0; q[b + 6] = 0;
    for (let i = 0; i < 6; i++) v[ballDofAdr + i] = 0;
    mujoco.mj_forward(model, data);
    const was = ballActive;
    ballActive = false;
    if (was) emit({ type: "ball", active: false });
  }
  // Drop the ball a little ahead of the duck (or at a given world x).
  function spawnBall(atX = null) {
    if (paused) setPaused(false);
    const q = data.qpos, v = data.qvel, b = ballQposAdr;
    const yaw = duckYaw(q);
    const x = atX ?? q[0] + Math.cos(yaw) * 0.4;
    q[b] = Math.min(halfX - 0.1, Math.max(-halfX + 0.1, x));
    q[b + 1] = 0;
    q[b + 2] = Math.max(q[2], getSupport().z) + 0.25;
    q[b + 3] = 1; q[b + 4] = 0; q[b + 5] = 0; q[b + 6] = 0;
    for (let i = 0; i < 6; i++) v[ballDofAdr + i] = 0;
    mujoco.mj_forward(model, data);
    ballActive = true;
    emit({ type: "ball", active: true });
    ensureKicks().catch((e) => onLog(`kick policies failed: ${e?.message ?? e}`));
  }
  function getBall() {
    if (!ballActive) return null;
    const q = data.qpos, v = data.qvel, b = ballQposAdr;
    return { x: q[b], y: q[b + 1], z: q[b + 2], vx: v[ballDofAdr], vy: v[ballDofAdr + 1], quat: [q[b + 3], q[b + 4], q[b + 5], q[b + 6]] };
  }
  function kick(foot = "left") {
    if (loco !== "legs" || recovery || mode !== "walk" || standTimer || grab || postKickLock > 0) return false;
    if (!sessions.kickL || !sessions.kickR) { ensureKicks().catch(() => {}); return false; }
    clearModeTimers();
    mode = foot === "left" ? "kickL" : "kickR";
    sitFlag = 0;
    kickRun = { steps: 0 };
    return true;
  }
  function groundPick() {
    if (loco !== "legs" || recovery || mode !== "walk" || standTimer || grab) return false;
    clearModeTimers();
    mode = "groundpick"; sitFlag = 0;
    pickRun = { phase: 0 };
    return true;
  }
  function startGrab(target, { upright = false } = {}) {
    if (paused) setPaused(false);
    if (mode === "sitstand") { clearModeTimers(); mode = "walk"; sitFlag = 0; lastAction.fill(0); }
    grab = { target: [...target], mass: model.body(trunkId).subtreemass, upright };
  }
  function moveGrab(target, yaw = null) { if (grab) { grab.target = [...target]; grab.yaw = yaw; } }
  function endGrab() {
    if (!grab) return;
    const xfrc = data.xfrc_applied;
    const a = trunkId * 6;
    xfrc[a] = 0; xfrc[a + 1] = 0; xfrc[a + 2] = 0;
    grab = null;
  }
  function setPaused(v) {
    paused = v;
    if (!v && wake) wake();
  }
  let phonesOn = false;
  const showPhones = () => { const phones = rig.bodies.get("jaw_soft")?.getObjectByName("headphones"); if (phones) phones.visible = phonesOn; };
  function setHeadphones(on) { phonesOn = Boolean(on); showPhones(); }
  function setVariant(name) {
    if (!VARIANTS[name] || name === currentVariant) return;
    currentVariant = name;
    applyVariant(rig, name);
  }

  // Ground-pick peck: open on the way down, snap shut on the scoop.
  const PICK_JAW_KEYS = [[0.10, 0], [0.20, 1], [0.40, 1], [0.50, 0]];
  function pickJaw() {
    const phase = mode === "groundpick" ? pickRun?.phase : null;
    if (phase == null) return 0;
    const K = PICK_JAW_KEYS;
    if (phase <= K[0][0] || phase >= K[K.length - 1][0]) return 0;
    for (let i = 1; i < K.length; i++) {
      if (phase > K[i][0]) continue;
      const [p0, v0] = K[i - 1];
      const [p1, v1] = K[i];
      const t = (phase - p0) / (p1 - p0);
      return v0 + (v1 - v0) * (1 - Math.cos(Math.PI * t)) / 2;
    }
    return 0;
  }

  // Ledges that would spawn inside the duck are held back until it moves.
  let platformsKey = "";
  function setPlatforms(list) {
    const key = JSON.stringify(list.map((pl) => [pl.x.toFixed(3), pl.z.toFixed(3), pl.halfW.toFixed(3)]));
    if (key !== platformsKey) { platformsKey = key; if (paused) setPaused(false); }
    const { x, z } = (() => { const q = data.qpos; return { x: q[0], z: q[2] }; })();
    platforms = list.filter((pl) => {
      const overlapsX = Math.abs(pl.x - x) < pl.halfW + 0.12;
      const insideBody = pl.z >= z - 0.06 && pl.z < z + 0.32;
      return !(overlapsX && insideBody);
    }).slice(0, PLATFORMS);
  }
  function getSupport() {
    const q = data.qpos, x = q[0], z = q[2];
    for (const pl of platforms) {
      if (Math.abs(x - pl.x) <= pl.halfW && pl.z <= z - 0.02 && pl.z > z - 0.25) {
        return { z: pl.z, xMin: pl.x - pl.halfW, xMax: pl.x + pl.halfW, platform: pl };
      }
    }
    return { z: 0, xMin: -halfX, xMax: halfX, platform: null };
  }

  return {
    get rig() { return rig; }, get trunkGroup() { return trunkGroup; }, get model() { return model; }, get data() { return data; },
    get loco() { return loco; }, get locoSwitching() { return locoSwitching; },
    velLimits, setLoco, crouch,
    spawnBall, parkBall, getBall, kick,
    get ballActive() { return ballActive; },
    get jointQposAdr() { return qposAdr; },
    get jawOpen() { return jawOpen; },
    syncRig, setPlatforms, getSupport,
    getPlatforms: () => platforms,
    setTwist(vx, wz) { twist[0] = vx; twist[1] = 0; twist[2] = wz; },
    setHead(neckPitch, headPitch, headYaw, headRoll = 0) {
      headTarget[0] = neckPitch; headTarget[1] = headPitch; headTarget[2] = headYaw; headTarget[3] = headRoll;
    },
    setJaw(open) { jawOpen = Math.min(1, Math.max(0, open) + pickJaw()); },
    getPose() {
      const q = data.qpos;
      return { x: q[0], y: q[1], z: q[2], yaw: duckYaw(q), speed: Math.hypot(data.qvel[0], data.qvel[1]) };
    },
    get mode() { return mode; },
    get sitting() { return mode === "sitstand" && sitFlag === 1; },
    get recovering() { return recovery !== null; },
    get grabbed() { return grab !== null; },
    get paused() { return paused; },
    get variant() { return currentVariant; },
    setHeadphones, get headphones() { return phonesOn; },
    debug: () => ({ twist: Array.from(twist), cmd: Array.from(cmd).slice(0, 7), ctrlSteps, lastAction: Array.from(lastAction).slice(0, 5) }),
    isBusy: () => mode !== "walk" || recovery !== null || standTimer !== null || grab !== null || locoSwitching,
    sit, stand, roll: doRoll, groundPick, startGrab, moveGrab, endGrab, reset: resetSim, setPaused, setVariant,
    on(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    dispose() { running = false; setPaused(false); },
  };
}

// Pet brain for the body: wander, idle, sit when bored, sleep when ignored,
// look at the cursor, and get out of the way of chat. Produces the twist
// the walking policy tracks; never touches the physics directly.


const ARRIVE_RADIUS = 0.12;
const TURN_GAIN = 2.2;
const SMOOTH_ALPHA = 0.15;
const IDLE_TO_SIT_S = 50;
const SIT_TO_SLEEP_S = 120;
const SKATE_COAST = 0.3; // metres skates roll on after the command stops
const CURSOR_DEPTH = -0.6; // the cursor lives out of the screen, toward the viewer

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createBehaviour({ sim, halfX, audio, onSleep, onWake, onSay }) {
  // Velocity limits follow the locomotion variant (skates are faster, turn slower).
  const lim = () => sim.velLimits();
  const VEL_FWD_ = () => lim()[0], VEL_BACK_ = () => lim()[1], VEL_ANG_ = () => lim()[2];
  const edgeMargin = (m) => m + (sim.loco === "rollers" ? SKATE_COAST : 0);
  let state = "idle";
  let timer = rand(1, 3);
  let idleFor = 0;
  let sitFor = 0;
  let target = null;
  let lastTrickAt = -Infinity;
  let cursor = null; // { x (MJCF), yPx, headPx } or null when far away
  let chatting = false;
  let speaking = false;
  let listening = false;
  const smooth = new Float32Array(3);
  let quackFlapUntil = 0;
  let pending = null; // one queued trick, run once the duck is free
  let danceUntil = 0;
  let commanded = false; // a move he asked for outlives the chat pause
  let hop = null; // scripted jump: the grab spring carries the trunk along an arc
  let kick = null; // { until } forward step that wakes the gait before reversing
  let kickEndedAt = -Infinity;
  let arc = null; // { since, movingSince, err0, sign } turning around in a forward arc
  let preHop = null; // { pl, until } turning to face a ledge before jumping
  let mood = { music: false, call: false, video: null };
  let gazeX = null; // world x to look at when no cursor is near (a video window)
  let hush = false; // in a call: no quacks, no tricks, sit at the edge
  let focus = false; // a focus block: same as a call, by request
  let sulking = false; // ignored for too long: sits at the far edge until touched
  let bowUntil = 0, leanUntil = 0, glanceUntil = 0, glanceX = null;
  let delivery = null; // { x, until, cb } walk over, bow, then hand the message over
  let pace = 1; // > 1 slows the idle rhythm (late evening, weekends)
  let ballPlay = false;
  let lastKickAt = 0;
  let linedSince = null; // when the duck first stood squared up to the ball

  const pose = () => sim.getPose();

  function pickTarget() {
    const { x } = pose();
    const sup = sim.getSupport();
    const margin = edgeMargin(sup.platform ? 0.22 : 0.15);
    const lo = sup.xMin + margin, hi = sup.xMax - margin;
    if (hi - lo < 0.2) { target = null; return; }
    let tx;
    for (let i = 0; i < 8; i++) {
      tx = rand(lo, hi);
      if (Math.abs(tx - x) > Math.min(0.4, (hi - lo) / 2)) break;
    }
    target = { x: tx, y: 0 };
  }

  // A ledge the duck can jump onto from where it stands.
  function reachableLedge() {
    const { x, z } = pose();
    const options = sim.getPlatforms().filter((pl) => {
      const rise = pl.z - z;
      const gap = Math.max(0, Math.abs(x - pl.x) - pl.halfW);
      return rise > 0.12 && rise < 0.6 && gap < 0.6 && pl.halfW > 0.16;
    });
    return options.length ? options[(Math.random() * options.length) | 0] : null;
  }
  const hopLandingX = (pl, x) => clamp(x, pl.x - pl.halfW + 0.15, pl.x + pl.halfW - 0.15);
  // Face the ledge first when it lies behind or beside the duck; the jump itself
  // then goes the way the duck is looking.
  function beginHop(pl) {
    const { x, yaw } = pose();
    const tx = hopLandingX(pl, x);
    const err = Math.abs(tx - x) < 0.05 ? 0 : wrapPi(Math.atan2(0, tx - x) - yaw);
    if (Math.abs(err) < 0.6) return startHop(pl);
    preHop = { pl, until: performance.now() + 9000 };
    state = "prehop";
    commanded = true;
    target = { x: x + Math.sign(tx - x) * 1.5, y: 0 };
  }
  function startHop(pl) {
    const { x, z } = pose();
    const tx = hopLandingX(pl, x);
    const to = { x: tx, z: pl.z + 0.118 };
    const yawFrom = pose().yaw;
    const yawTo = Math.abs(tx - x) < 0.05 ? yawFrom : (tx > x ? 0 : Math.PI); // land facing the way it jumped
    hop = { t: 0, dur: 0.9 + Math.abs(tx - x) * 0.4, settle: 0.6, from: { x, z }, to, yawFrom, yawTo, lift: Math.max(z, to.z) + 0.22 - (z + to.z) / 2 };
    sim.startGrab([x, 0, z], { upright: true });
    quack();
    state = "hop";
    commanded = true;
    target = null;
  }
  function nearestLedge() {
    const { x, z } = pose();
    const above = sim.getPlatforms().filter((pl) => pl.z > z + 0.12 && pl.halfW > 0.15);
    above.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    return above[0] ?? null;
  }
  function stepOff() {
    const sup = sim.getSupport();
    if (!sup.platform) return false;
    const { x } = pose();
    const edge = x - sup.xMin < sup.xMax - x ? sup.xMin - 0.3 : sup.xMax + 0.3;
    enter("wander");
    target = { x: edge, y: 0 };
    timer = 8;
    return true;
  }

  // The walking policy barely turns on the spot, so steering always carries
  // some forward speed. A target behind the duck is reached by turning around
  // in a tight forward arc bent toward the centre line; if the arc makes no
  // headway (or on skates, which turn too slowly), the duck walks backwards.
  function steer(dt) {
    if (!target) { arc = null; return [0, 0]; }
    const { x, y, yaw } = pose();
    const dx = target.x - x, dy = target.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist < ARRIVE_RADIUS) { target = null; arc = null; return [0, 0]; }
    const err = wrapPi(Math.atan2(dy, dx) - yaw);
    const near = clamp(dist / 0.3 + 0.3, 0, 1);
    if (Math.abs(err) > 2.0 && sim.loco === "legs" && !arc?.gaveUp) {
      const now = performance.now();
      const speed = pose().speed;
      if (!arc) {
        const toCentre = -Math.sign(y * Math.cos(yaw));
        arc = { since: now, movingSince: null, err0: Math.abs(err), sign: Math.abs(y) > 0.04 && toCentre ? toCentre : Math.sign(err) || 1 };
      }
      if (arc.movingSince === null && speed > 0.1) { arc.movingSince = now; arc.err0 = Math.abs(err); }
      const turning = arc.movingSince !== null;
      if ((turning && now - arc.movingSince > 3500 && arc.err0 - Math.abs(err) < 0.5) || now - arc.since > 7000) {
        arc.gaveUp = true; // not turning: fall through to the reverse gait
      }
      // The gait only starts from a brisk forward step; ease off once it is going.
      if (!arc.gaveUp) return [turning ? 0.07 : VEL_FWD_(), arc.sign * VEL_ANG_()];
    }
    if (Math.abs(err) <= 1.2) arc = null;
    if (Math.abs(err) > 2.0) {
      // The gait only starts from a forward step: rock forward until the duck is
      // actually moving (at most 0.9 s), then walk backwards toward the target.
      const now = performance.now();
      const speed = pose().speed;
      if (!kick && speed < 0.05 && now - kickEndedAt > 1200) kick = { until: now + 900 };
      if (kick) {
        if (now < kick.until && speed < 0.12) return [VEL_FWD_(), 0];
        kick = null;
        kickEndedAt = now;
      }
      const backErr = wrapPi(err + Math.PI); // heading error for walking backwards
      return [VEL_BACK_() * near, clamp(TURN_GAIN * backErr, -Math.min(0.4, VEL_ANG_()), Math.min(0.4, VEL_ANG_()))];
    }
    kick = null;
    const wz = clamp(TURN_GAIN * err, -VEL_ANG_(), VEL_ANG_());
    const vx = VEL_FWD_() * Math.max(0.3, Math.cos(err)) * near;
    return [vx, wz];
  }

  function lookAtCursor() {
    // The skate policy cannot balance with its head turned; it tips over within a second.
    if (sim.loco === "rollers") { sim.setHead(0, 0, 0, 0); return; }
    const now = performance.now();
    if (bowUntil > now) { const k = Math.min(1, (bowUntil - now) / 300); sim.setHead(0.75 * k, 0.55 * k, 0, 0); return; } // bow for a delivery
    if (leanUntil > now) { const k = Math.sin(now / 160); sim.setHead(-0.15, -0.35, 0.2 * k, 0.4); return; } // leaning into a stroke
    if (listening) { sim.setHead(0.25, -0.1, 0, 0.35); return; } // ear cocked toward you
    if (!cursor && glanceUntil > now && glanceX !== null) {
      const { x, yaw } = pose();
      sim.setHead(0.15, -0.15, clamp(wrapPi(Math.atan2(CURSOR_DEPTH, glanceX - x) - yaw), -0.9, 0.9), 0);
      return;
    }
    if (!cursor && mood.music && !sim.sitting) { const bob = Math.sin(performance.now() / 290); sim.setHead(0.35 * bob, -0.35 * bob, 0, 0.15 * Math.sin(performance.now() / 580)); return; }
    if (!cursor && gazeX !== null) {
      const { x, yaw } = pose();
      sim.setHead(0.2, -0.2, clamp(wrapPi(Math.atan2(CURSOR_DEPTH, gazeX - x) - yaw), -0.9, 0.9), 0);
      return;
    }
    if (!cursor || sim.sitting) { sim.setHead(0, 0, 0, 0); return; }
    const { x, yaw } = pose();
    const ang = wrapPi(Math.atan2(CURSOR_DEPTH, cursor.x - x) - yaw);
    const headYaw = clamp(ang, -0.9, 0.9);
    const up = clamp((cursor.headPx - cursor.yPx) / 260, -0.7, 0.7);
    sim.setHead(0.5 * up, -0.5 * up, headYaw, 0);
  }

  function enter(next) {
    state = next;
    if (next === "idle") { timer = rand(1.5, 6) * pace; target = null; commanded = false; }
    if (next === "wander") { pickTarget(); timer = 20; }
    if (next === "sit") { sitFor = 0; sim.sit(); }
  }

  function wake(reason = "poke") {
    idleFor = 0;
    if (reason === "poke" || reason === "chat") sulking = false;
    if (state === "sleep") {
      sim.setPaused(false);
      onWake?.();
      enter("idle");
      sim.stand();
    } else if (state === "sit" && reason !== "cursor") {
      sim.stand();
      enter("idle");
    }
  }

  function quack() {
    if (hush || focus) return;
    quackFlapUntil = performance.now() + audio.chirp(sim.variant);
  }

  function update(dt, nowMs) {
    if (state === "hop" && hop) {
      hop.t += dt;
      const u = Math.min(1, hop.t / hop.dur);
      const hx = hop.from.x + (hop.to.x - hop.from.x) * u;
      const hz = (1 - u) * hop.from.z + u * hop.to.z + 4 * hop.lift * u * (1 - u);
      const yaw = hop.yawFrom + wrapPi(hop.yawTo - hop.yawFrom) * Math.min(1, u * 1.5);
      sim.moveGrab([hx, 0, hz], yaw);
      if (hop.t >= hop.dur + hop.settle) { sim.endGrab(); hop = null; enter("idle"); timer = rand(3, 5); }
      return;
    }
    if (sim.grabbed) { smooth.fill(0); sim.setTwist(0, 0); idleFor = 0; return; }
    const busy = sim.isBusy();
    let [vx, wz] = [0, 0];
    if (pending && !busy) { const act = pending; pending = null; act(); }
    if (state === "sleep") return;

    // Talking pauses the duck's own wandering; a move he asked for carries on.
    const paused = (chatting || speaking || listening) && !commanded;
    if (paused) {
      idleFor = 0;
      if (state !== "sit" && state !== "idle") enter("idle");
    }

    if (state === "idle") {
      if (!paused) {
        idleFor += dt;
        timer -= dt;
        if (!busy && timer <= 0) {
          const r = Math.random();
          const ledge = reachableLedge();
          const skating = sim.loco === "rollers";
          if (ballPlay && !skating && !hush && r < 0.6) { state = "chase"; commanded = false; timer = rand(8, 14); }
          else if (hush || focus || mood.video || sulking) { if (!skating && !sim.sitting && state !== "sit") enter("sit"); timer = rand(5, 9); }
          else if (mood.music && r < 0.3 && !skating) { state = "dance"; commanded = false; danceUntil = nowMs + rand(3000, 6000); target = null; }
          else if (idleFor > IDLE_TO_SIT_S && !skating) enter("sit");
          else if (skating && r < 0.2) { sim.crouch(); timer = rand(4, 7); }
          else if (r < 0.12 && sim.getSupport().platform) stepOff();
          else if (r < 0.3 && ledge) beginHop(ledge);
          else if (r < 0.55) enter("wander");
          else if (r < 0.7) { quack(); timer = rand(2, 5); }
          else if (r < 0.82 && !skating) { sim.groundPick(); timer = rand(3, 6); }
          else if (r < 0.88 && nowMs - lastTrickAt > 90000) { lastTrickAt = nowMs; sim.roll(); timer = rand(3, 6); }
          else timer = rand(2, 6) * pace;
        }
      }
    } else if (state === "deliver") {
      // Walk toward the owner, then bow and hand over; never wait more than a few seconds.
      if (!busy) [vx, wz] = steer(dt);
      if (delivery && (!target || nowMs > delivery.until)) {
        const cb = delivery.cb; delivery = null; target = null;
        bowUntil = nowMs + 1400;
        setTimeout(cb, 350);
        enter("idle"); timer = rand(4, 8);
      }
    } else if (state === "chase") {
      const ball = sim.getBall();
      if (!ball || sim.loco !== "legs") { enter("idle"); }
      else {
        const { x, y, yaw, speed } = pose();
        const dx = ball.x - x, dy = ball.y - y;
        const dist = Math.hypot(dx, dy);
        const err = wrapPi(Math.atan2(dy, dx) - yaw);
        const lateral = dy * Math.cos(yaw) - dx * Math.sin(yaw); // + means the ball is to the duck's left
        const ballStill = Math.hypot(ball.vx, ball.vy) < 0.15;
        // Line up like the standing test that worked: ball 0.10 to 0.13 m ahead,
        // nearly straight on, duck standing still, then swing the nearer foot.
        const lined = dist > 0.078 && dist < 0.112 && Math.abs(err) < 0.25 && speed < 0.04;
        if (lined) linedSince ??= nowMs; else linedSince = null;
        if (lined && nowMs - linedSince > 800 && ballStill && nowMs - lastKickAt > 2500 && !busy) {
          lastKickAt = nowMs;
          const foot = lateral < -0.02 ? "right" : "left";
          console.log(`kick: d=${dist.toFixed(3)} err=${err.toFixed(2)} lateral=${lateral.toFixed(3)} foot=${foot} ballz=${ball.z.toFixed(3)}`);
          if (sim.kick(foot)) { quack(); timer = rand(2, 4); }
        } else if (!busy) {
          if (Math.abs(err) > 2.0 || dist > 0.5) {
            target = { x: ball.x, y: 0 };
            [vx, wz] = steer(dt); // far or behind: normal steering (turns, reverses)
          } else if (dist > 0.1) {
            vx = VEL_FWD_() * clamp((dist - 0.1) / 0.25 + 0.3, 0.3, 1);
            wz = clamp(TURN_GAIN * err, -VEL_ANG_(), VEL_ANG_());
          } else if (dist < 0.068) {
            vx = VEL_BACK_() * 0.6; wz = 0; // too close: back off a touch
          } else {
            vx = 0; wz = clamp(TURN_GAIN * err, -0.6, 0.6); // in range: square up and settle
          }
        }
        timer -= dt;
        if (timer <= 0) enter("idle");
      }
    } else if (state === "dance") {
      // Wiggle: the walking policy tracks a yaw rate that flips sign a few times a second.
      if (!busy) { vx = 0.12 * Math.sin(nowMs / 260); wz = Math.sin(nowMs / 160) * VEL_ANG_(); }
      if (nowMs > danceUntil) enter("idle");
    } else if (state === "prehop") {
      if (!preHop) enter("idle");
      else {
        const { x, yaw } = pose();
        const tx = hopLandingX(preHop.pl, x);
        const err = Math.abs(tx - x) < 0.05 ? 0 : wrapPi(Math.atan2(0, tx - x) - yaw);
        if (Math.abs(err) < 0.5 || nowMs > preHop.until) { const pl = preHop.pl; preHop = null; startHop(pl); }
        else if (!busy) { target = { x: x + Math.sign(tx - x) * 1.5, y: 0 }; [vx, wz] = steer(dt); }
      }
    } else if (state === "wander") {
      timer -= dt;
      if (!busy) [vx, wz] = steer(dt);
      if (!target || timer <= 0) enter("idle");
    } else if (state === "sit") {
      // A sit asked for while the body was busy was refused; start it once the body is free.
      if (!busy && !sim.sitting && sim.mode === "walk" && sim.loco === "legs") sim.sit();
      if (!paused && !hush) sitFor += dt;
      if (sitFor > SIT_TO_SLEEP_S && sim.sitting && pose().z < 0.08) {
        state = "sleep";
        sim.setPaused(true);
        onSleep?.();
        return;
      }
    }

    smooth[0] += SMOOTH_ALPHA * (vx - smooth[0]);
    smooth[2] += SMOOTH_ALPHA * (wz - smooth[2]);
    sim.setTwist(smooth[0], smooth[2]);
    lookAtCursor();

    // Jaw: speech flap on top of quack flaps.
    const tq = (nowMs - (quackFlapUntil - 480)) / 480;
    const flap = tq >= 0 && tq < 1 ? Math.sin(Math.PI * tq) : 0;
    const talk = speaking ? 0.25 + 0.45 * Math.abs(Math.sin(nowMs / 70) * Math.sin(nowMs / 190)) : 0;
    sim.setJaw(Math.max(flap, talk));

    // Doze: standing still in idle with nobody around, the physics can stop
    // until the next idle timer or any interaction; the picture is identical.
    const still = (state === "idle" && !busy && timer > 0.6) || (state === "sit" && sim.sitting && pose().z < 0.08);
    const doze = still && !paused && cursor === null && !mood.music && !mood.video &&
      pose().speed < 0.02 && !sim.grabbed && Math.abs(smooth[0]) < 0.01 && Math.abs(smooth[2]) < 0.01 &&
      nowMs > quackFlapUntil + 200;
    if (doze !== sim.paused) sim.setPaused(doze);
  }

  return {
    update,
    get state() { return state; },
    get target() { return target; },
    setCursor(c) {
      cursor = c;
      if (c && state === "sleep") wake("cursor");
    },
    poke() { wake("poke"); if (!sim.isBusy()) quack(); },
    wakeUp() { wake("nap"); },
    pet() { wake("poke"); leanUntil = performance.now() + 1900; quack(); },
    glance(x) { glanceX = x; glanceUntil = performance.now() + 2600; },
    bow() { bowUntil = performance.now() + 1400; },
    setPace(v) { pace = clamp(v, 0.5, 3); },
    // Something to hand over: walk toward x (the owner's cursor, usually), bow, then cb.
    deliver(x, cb) {
      wake("chat");
      if (state === "hop" || sim.grabbed) { cb(); return; }
      const { x: px } = pose();
      if (x === null || Math.abs(px - x) < 0.25 || sim.loco !== "legs") { bowUntil = performance.now() + 1400; setTimeout(cb, 350); return; }
      state = "deliver"; commanded = true;
      target = { x: clamp(x, -halfX + 0.15, halfX - 0.15), y: 0 };
      delivery = { x, until: performance.now() + 7000, cb };
    },
    // Ignored for too long: walk to the far edge and sit facing the wall.
    sulk() {
      if (sulking || state === "sleep") return;
      sulking = true;
      const { x } = pose();
      const edge = x >= 0 ? halfX - 0.2 : -halfX + 0.2;
      if (Math.abs(x - edge) > 0.3) { enter("wander"); commanded = true; target = { x: edge, y: 0 }; timer = 30; }
      else { enter("idle"); timer = 0.2; }
    },
    get sulking() { return sulking; },
    // A bid for attention: come toward the owner if we know where, else a small show.
    attention(x) {
      wake("poke");
      if (x !== null && Math.abs(pose().x - x) > 0.3) { enter("wander"); commanded = true; target = { x: clamp(x, -halfX + edgeMargin(0.15), halfX - edgeMargin(0.15)), y: 0 }; timer = 20; return "come"; }
      if (Math.random() < 0.5) { quack(); state = "dance"; commanded = true; danceUntil = performance.now() + 3000; target = null; return "dance"; }
      quack(); return "quack";
    },
    setFocus(on) {
      const was = focus; focus = !!on;
      if (focus && !was && state !== "sleep") {
        const { x } = pose();
        const edge = x >= 0 ? halfX - 0.25 : -halfX + 0.25;
        wake("chat");
        if (Math.abs(x - edge) > 0.3) { enter("wander"); commanded = true; target = { x: edge, y: 0 }; timer = 30; }
        else { enter("idle"); timer = 0.2; }
      }
      if (was && !focus && state === "sit") { sim.stand(); enter("idle"); }
    },
    get focus() { return focus; },
    setChatting(v) { chatting = v; if (v) wake("chat"); },
    setSpeaking(v) { speaking = v; if (v) idleFor = 0; },
    setListening(v) { listening = v; if (v) wake("chat"); },
    get engaged() { return chatting || speaking || listening || cursor !== null; },
    quack,
    goTo(x) { wake(); enter("wander"); commanded = true; target = { x: clamp(x, -halfX + edgeMargin(0.15), halfX - edgeMargin(0.15)), y: 0 }; timer = 25; },
    dance() { wake(); quack(); state = "dance"; commanded = true; danceUntil = performance.now() + 4500; target = null; },
    hop() { wake(); const pl = reachableLedge() ?? nearestLedge(); if (pl) beginHop(pl); return !!pl; },
    setBall(active) { ballPlay = active; if (active) { wake(); state = "chase"; commanded = true; timer = 14; } else if (state === "chase") enter("idle"); },
    kickNow() { wake(); const ball = sim.getBall(); if (ball) { state = "chase"; commanded = true; timer = 10; lastKickAt = 0; } else sim.kick("left"); },
    // Someone's talking to a camera, or a film is on: move to the edge, sit, watch or keep quiet.
    setMood(next) {
      const wasHush = hush;
      mood = { music: !!next.music, call: !!next.call, video: next.video ?? null };
      hush = mood.call;
      gazeX = mood.video ? mood.video.worldX : null;
      if ((hush || mood.video) && !wasHush && state !== "sleep") {
        const { x } = pose();
        const awayFrom = mood.video ? mood.video.worldX : x;
        const edge = awayFrom >= 0 ? -halfX + 0.25 : halfX - 0.25;
        wake();
        // Walk to the edge; the hushed idle branch sits it down on arrival.
        if (Math.abs(x - edge) > 0.3) { enter("wander"); commanded = true; target = { x: edge, y: 0 }; timer = 30; }
        else { enter("idle"); timer = 0.2; }
      }
      if (wasHush && !hush && state === "sit") { sim.stand(); enter("idle"); }
    },
    async setLoco(name) { wake(); if (state === "sit") { sim.stand(); await new Promise((r) => setTimeout(r, 2200)); } const ok = await sim.setLoco(name); if (ok) { enter("idle"); timer = rand(1, 2); } return ok; },
    hopTo(pl) { wake(); beginHop(pl); },
    stepOff() { wake(); return stepOff(); },
    get cursorX() { return cursor?.x ?? null; },
    sit() { wake(); if (sim.sit()) { state = "sit"; sitFor = 0; } else pending = () => { if (sim.sit()) { state = "sit"; sitFor = 0; } }; },
    stand() { wake(); },
    roll() { wake(); if (!sim.roll()) pending = () => sim.roll(); },
    pick() { wake(); if (!sim.groundPick()) pending = () => sim.groundPick(); },
    sleep() {
      if (state === "sleep") return;
      const doze = () => { enter("sit"); sitFor = SIT_TO_SLEEP_S; };
      // The skate switch resets the body, which drops the duck to idle, so sit only after it lands.
      const offSkates = () => sim.setLoco("legs").then((ok) => { if (ok) doze(); else pending = offSkates; });
      if (sim.loco === "rollers") offSkates(); else doze();
    },
    onDropped() {
      idleFor = 0;
      if (state === "sit" && sitFor >= SIT_TO_SLEEP_S) return; // a requested sleep outlives the reset of a failed trick
      enter("idle"); timer = rand(2, 4);
    },
  };
}

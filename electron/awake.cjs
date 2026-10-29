// Keeping the Mac awake, the way caffeinate or Amphetamine do: one power-save
// assertion while the owner wants it, for a set time or until told otherwise.
// Never remembered across launches; an assertion that outlives the ask is the
// thing people dislike about those tools. Lid close still sleeps the Mac.
const MAX_MIN = 12 * 60;

function createAwake({ powerSaveBlocker, onChange = () => {}, log = () => {} }) {
  let id = null, until = 0, timer = null;

  const active = () => id !== null && powerSaveBlocker.isStarted(id);
  const remainingMin = () => (active() && until ? Math.max(1, Math.ceil((until - Date.now()) / 60000)) : 0);

  function stop(reason = "off") {
    if (timer) clearTimeout(timer);
    timer = null; until = 0;
    if (id === null) return false;
    powerSaveBlocker.stop(id); id = null;
    log(`[awake] off (${reason})`);
    onChange({ active: false, minutes: 0, reason });
    return true;
  }

  // minutes > 0: that long; minutes < 0: until told otherwise; 0: let it sleep.
  function set(minutes, origin = "chat") {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m === 0) return stop();
    if (timer) clearTimeout(timer);
    timer = null;
    if (!active()) id = powerSaveBlocker.start("prevent-display-sleep");
    if (m > 0) {
      const capped = Math.min(MAX_MIN, Math.ceil(m));
      until = Date.now() + capped * 60000;
      timer = setTimeout(() => stop("timer"), capped * 60000);
      log(`[awake] on for ${capped} min`);
      onChange({ active: true, minutes: capped, reason: "on", origin });
    } else {
      until = 0;
      log("[awake] on until told otherwise");
      onChange({ active: true, minutes: -1, reason: "on", origin });
    }
    return true;
  }

  return { set, stop, active, remainingMin, get until() { return until; } };
}

module.exports = { createAwake, AWAKE_MAX_MIN: MAX_MIN };

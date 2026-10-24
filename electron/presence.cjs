// Where the owner is: at the keyboard, away, back after a break, just unlocked
// the Mac. Built on Electron's powerMonitor plus its idle counter. Emits
// { event, idleMin, hour, weekend } so the pet can greet and pace itself.
const { powerMonitor } = require("electron");

const AWAY_AFTER_MIN = 8;

function createPresence({ onEvent, log = () => {} }) {
  let away = false;
  let awaySince = null;
  let timer = null;
  const now = () => new Date();
  const snapshot = (event, extra = {}) => {
    const d = now();
    return { event, hour: d.getHours(), weekend: d.getDay() === 0 || d.getDay() === 6, ...extra };
  };
  const fire = (event, extra) => { const e = snapshot(event, extra); log(`[presence] ${JSON.stringify(e)}`); onEvent(e); };

  function tick() {
    const idleS = powerMonitor.getSystemIdleTime();
    if (!away && idleS >= AWAY_AFTER_MIN * 60) { away = true; awaySince = Date.now() - idleS * 1000; fire("away", { idleMin: Math.round(idleS / 60) }); }
    else if (away && idleS < 20) {
      const gone = Math.round((Date.now() - awaySince) / 60000);
      away = false; awaySince = null;
      fire("back", { idleMin: gone });
    }
  }
  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, 10000);
      powerMonitor.on("unlock-screen", () => { away = false; awaySince = null; fire("unlock"); });
      powerMonitor.on("lock-screen", () => { if (!away) { away = true; awaySince = Date.now(); } fire("lock"); });
      powerMonitor.on("resume", () => fire("resume"));
      setTimeout(() => fire("launch"), 2500);
    },
    stop() { clearInterval(timer); timer = null; },
    get away() { return away; },
    idleMinutes() { return powerMonitor.getSystemIdleTime() / 60; },
  };
}

module.exports = { createPresence };

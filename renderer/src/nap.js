// A nap: sleep shortly, wake up by itself after a while.
export function createNapper({ sleep, onDone, randomMinutes = () => 5 + Math.round(Math.random() * 6) }) {
  let timer = null;
  return {
    get pending() { return timer !== null; },
    start(ms = null) {
      // A nap asked for now replaces one already running, so "nap for 5 seconds"
      // works even while the duck's own long nap is pending.
      if (timer) clearTimeout(timer);
      const napFor = ms ?? randomMinutes() * 60000;
      setTimeout(sleep, 1500);
      timer = setTimeout(() => { timer = null; onDone(napFor); }, napFor);
    },
  };
}

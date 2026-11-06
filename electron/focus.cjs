// Focus: the pet sits quietly, nudges queue up, a chime at the end.
function createFocus({ send, push }) {
  let until = 0, timer = null, length = 0;
  const focusing = () => until > Date.now();
  function setFocus(minutes) {
    clearTimeout(timer);
    if (!minutes) {
      if (until) { until = 0; send({ type: "focus", minutes: 0 }); push("focus", `Focus block done. ${length} minutes, well held.`, { urgent: true }); }
      return;
    }
    length = minutes; until = Date.now() + minutes * 60000;
    send({ type: "focus", minutes });
    timer = setTimeout(() => setFocus(0), minutes * 60000);
  }
  return {
    setFocus, focusing,
    remainingMin: () => (focusing() ? Math.ceil((until - Date.now()) / 60000) : 0),
    stop() { clearTimeout(timer); },
  };
}

module.exports = { createFocus };

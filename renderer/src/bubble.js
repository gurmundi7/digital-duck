// Comic speech bubble pinned above the duck's head: shows what it says,
// takes typed input, and shows a thinking state while the brain works.
export function createBubble({ onSubmit, onOpenChange }) {
  const el = document.getElementById("bubble");
  const text = el.querySelector(".text");
  let hideTimer = null;
  let input = null;
  let anchor = { x: 0, y: 0 };
  let open = false;

  function place() {
    el.style.left = `${anchor.x}px`;
    el.style.top = `${anchor.y}px`;
    const r = el.getBoundingClientRect();
    const minLeft = r.width / 2 + 8;
    const maxLeft = innerWidth - r.width / 2 - 8;
    el.style.left = `${Math.min(maxLeft, Math.max(minLeft, anchor.x))}px`;
    if (r.top < 4) el.style.top = `${anchor.y + (4 - r.top)}px`;
  }
  function setOpen(v) {
    if (open === v) return;
    open = v;
    el.classList.toggle("show", v);
    onOpenChange?.(v);
  }
  function clearInput() {
    input?.remove();
    input = null;
  }
  function show(msg, { ttlMs = 9000 } = {}) {
    clearTimeout(hideTimer);
    clearInput();
    text.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = msg;
    text.appendChild(span);
    setOpen(true);
    place();
    if (ttlMs > 0) hideTimer = setTimeout(() => setOpen(false), ttlMs);
  }
  function thinking() {
    clearTimeout(hideTimer);
    clearInput();
    text.innerHTML = '<span class="thinking">· · ·</span>';
    setOpen(true);
    place();
  }
  function prompt() {
    clearTimeout(hideTimer);
    text.innerHTML = "";
    input = document.createElement("input");
    input.placeholder = "Say something to the duck…";
    input.autocomplete = "off";
    input.spellcheck = false;
    text.appendChild(input);
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Enter to send · Esc to close";
    text.appendChild(hint);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { hide(); }
      if (e.key === "Enter" && input.value.trim()) {
        const v = input.value.trim();
        onSubmit?.(v);
      }
    });
    setOpen(true);
    place();
    setTimeout(() => input?.focus(), 30);
  }
  function hide() {
    clearTimeout(hideTimer);
    clearInput();
    setOpen(false);
  }
  return {
    show, thinking, prompt, hide,
    isPrompting: () => !!input,
    setAnchor(x, y) { anchor = { x, y }; if (open) place(); },
    setLevel(rms) {
      const span = text.querySelector("span");
      if (!span || !span.textContent.startsWith("listening")) return;
      const n = Math.min(8, Math.round(rms * 120));
      span.textContent = `listening ${"●".repeat(n)}${"○".repeat(8 - n)}`;
    },
    get open() { return open; },
    get hasInput() { return input !== null; },
    contains(x, y) {
      if (!open) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 14;
    },
  };
}

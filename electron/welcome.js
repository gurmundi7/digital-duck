// The welcome tour. Main sends what it knows (tour:load) and the duck's events (tour:event):
// "dropped" after a drag, "replied" after an answer, "key-closed" when the key window shuts.
const stepEl = document.getElementById("step");
const dotsEl = document.getElementById("dots");
const countEl = document.getElementById("step-count");
const backBtn = document.getElementById("back");
const nextBtn = document.getElementById("next");
const skipBtn = document.getElementById("skip");

let info = null;
let index = 0;
let stepEvents = {};

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "on") for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn);
    else if (key === "class") node.className = value;
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child);
  return node;
}
const keys = (combo) => String(combo ?? "").split("+").map((part, i) => [i ? "+" : "", h("kbd", {}, part)]);

function brainLine(brain) {
  if (brain.ready) return h("div", { class: "status ok" }, `Answering with ${brain.label}.`);
  const why = { install: `${brain.label} isn't installed on this Mac.`, key: `${brain.label} needs a key.`, pick: "No brain picked yet." }[brain.need];
  return h("div", { class: "status" }, `To talk back I need a brain. ${why} Pick one, or skip: moves work without one.`);
}

function brainPicker() {
  return h("div", { class: "choices" }, info.choices.map((choice) => h("button", {
    class: "choice",
    on: { click: async () => { info.brain = await window.tour.useBrain(choice.id); render(); } },
  }, choice.kind === "cli" || choice.hasKey ? `Use ${choice.label}` : `${choice.label}: add a key`,
  h("span", { class: "muted" }, choice.kind === "cli" ? "installed" : choice.hasKey ? "key saved" : choice.keyUrl))));
}

const STEPS = [
  {
    next: "Let's go",
    enter: () => setTimeout(() => window.tour.act("dance"), 500),
    render: () => [
      h("div", { class: "art" }, "🦆"),
      h("h1", {}, info.name ? `Hi ${info.name}, I'm your duck.` : "Hi, I'm your duck."),
      h("p", {}, "I live along the bottom of your screen. I walk, nap, chase your cursor and keep you company."),
      h("p", {}, "Talk to me and I can answer questions, set reminders, keep the Mac awake and react when music or a call starts."),
      h("p", { class: "muted" }, "Clicks anywhere but on me go straight to your apps, so I never get in the way. This takes a minute."),
      h("button", { on: { click: () => window.tour.act("dance") } }, "Dance again"),
    ],
  },
  {
    events: { dropped: () => { stepEvents.dropped = true; render(); setTimeout(() => { if (index === 1) go(1); }, 1400); } },
    render: () => [
      h("div", { class: "art" }, "✋"),
      h("h1", {}, "Pick me up"),
      h("p", {}, "Drag me with the mouse and let go anywhere. I'll land and carry on."),
      stepEvents.dropped ? h("div", { class: "status ok" }, "Nice catch.") : h("div", { class: "status" }, "Waiting for you to drop me…"),
    ],
  },
  {
    events: {
      replied: () => { stepEvents.replied = true; render(); },
      "key-closed": async () => { info = await window.tour.load(); render(); },
    },
    render: () => [
      info.brain.ready && h("div", { class: "art" }, "💬"),
      h("h1", {}, "Talk to me"),
      info.brain.ready
        ? [
          h("p", {}, "Click me, type ", h("b", {}, "hi"), " and press Return."),
          h("p", {}, "From any app, ", keys(info.typeHotkey), " opens the same box."),
        ]
        : [brainLine(info.brain), brainPicker(), h("p", { class: "muted" }, "Keys stay in your macOS Keychain.")],
      info.brain.ready && (stepEvents.replied ? h("div", { class: "status ok" }, "That's me talking. Answers show in my bubble, and I say them out loud.") : brainLine(info.brain)),
    ],
  },
  {
    render: () => [
      h("div", { class: "art" }, "🎾"),
      h("h1", {}, "Things to try"),
      h("p", {}, "Each one goes to me as if you typed it."),
      h("div", { class: "chips" }, info.phrases.map((phrase) => h("button", {
        class: "chip",
        disabled: phrase.brain && !info.brain.ready,
        title: phrase.brain && !info.brain.ready ? "Needs a brain (previous step)" : null,
        on: { click: () => window.tour.tryPhrase(phrase.text) },
      }, phrase.text))),
      h("p", { class: "muted" }, info.listen
        ? ["Voice: press ", keys(info.hotkey), " and talk."]
        : "Voice: turn on Voice input in Settings, then press a hotkey and talk."),
    ],
  },
  {
    next: "Done",
    render: () => [
      h("div", { class: "art" }, "🏁"),
      h("h1", {}, "You're set"),
      h("ul", {},
        h("li", {}, h("b", {}, "🦆 in the menu bar"), ": moves, colour, quiet mode, reminders, focus and Settings."),
        h("li", {}, h("b", {}, "Right-click me"), " for the same menu."),
        h("li", {}, h("b", {}, "Settings"), ": my brain, my voice, and what I'm allowed to do on your Mac."),
        h("li", {}, "This tour is in the 🦆 menu under ", h("b", {}, "Welcome tour"), "."),
      ),
      h("label", { class: "check" },
        h("input", { type: "checkbox", id: "login", checked: info.login, on: { change: async (e) => { info.login = await window.tour.setLogin(e.target.checked); e.target.checked = info.login; } } }),
        "Start me when you log in"),
      h("p", {}, h("button", { on: { click: () => window.tour.openSettings() } }, "Open Settings")),
    ],
  },
];

function render() {
  const step = STEPS[index];
  stepEl.replaceChildren(...[step.render()].flat(3).filter(Boolean));
  dotsEl.replaceChildren(...STEPS.map((_, i) => h("i", { class: i === index ? "on" : i < index ? "done" : "" })));
  countEl.textContent = `${index + 1} of ${STEPS.length}`;
  backBtn.hidden = index === 0;
  skipBtn.hidden = index === STEPS.length - 1;
  nextBtn.textContent = step.next ?? "Next";
}

function go(delta) {
  const target = index + delta;
  if (target >= STEPS.length) { window.tour.done(); return; }
  index = Math.max(0, target);
  stepEvents = {};
  render();
  STEPS[index].enter?.();
  nextBtn.focus();
}

window.tour.onEvent((name) => STEPS[index]?.events?.[name]?.());
nextBtn.addEventListener("click", () => go(1));
backBtn.addEventListener("click", () => go(-1));
skipBtn.addEventListener("click", () => window.tour.done());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.tour.done();
  else if (e.key === "Enter" && e.target === document.body) go(1);
});

window.tour.load().then((loaded) => {
  info = loaded;
  render();
  STEPS[0].enter();
  nextBtn.focus();
});

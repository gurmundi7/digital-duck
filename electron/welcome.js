// The welcome tour. Main sends what it knows (tour:load) and the duck's events (tour:event):
// "dropped" after a drag, "replied" after an answer, "reply-failed" with what to do about it,
// and "key-closed" when the key window shuts.
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

// Step 3 for someone with no brain yet: pick by what they have, follow the guide, check, test.
// `setup.view` is "choices", "guide" or "test"; `message` is what went wrong, in plain words.
let setup = { view: "choices" };
const KEY_NAMES = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini" };

async function runCheck(id) {
  setup = { ...setup, checking: true, message: null };
  render();
  const res = await window.tour.check(id);
  if (!res.ok) { setup = { ...setup, checking: false, message: res.message }; render(); return; }
  info.brain = res.brain;
  setup = { view: "test", id };
  stepEvents = {};
  render();
  window.tour.test();
}
async function pick(id) {
  if (id.startsWith("use:")) { setup = { view: "choices", id, switching: setup.switching }; return runCheck(id); }
  setup = { view: "guide", id, guide: await window.tour.guide(id), switching: setup.switching };
  render();
}
const run = (fn) => fn();
const status = (text, ok = false) => h("div", { class: ok ? "status ok" : "status" }, text);

function choicesView() {
  return [
    setup.switching && h("button", { class: "link", on: { click: () => { setup = { view: "choices" }; render(); } } }, `← Keep ${info.brain.label}`),
    h("h1", {}, "Give me a brain"),
    h("p", {}, "I answer with an AI you have, or a free one on this Mac."),
    h("div", { class: "choices" }, info.choices.map((choice) => h("button", { class: "choice", disabled: !!setup.checking, on: { click: () => pick(choice.id) } },
      h("b", {}, choice.title), h("span", { class: "muted" }, choice.note)))),
    setup.message ? status(setup.message) : h("p", { class: "muted" }, "No rush: moves work without one. Next skips this."),
  ];
}

function stepView(step, i, firstCommand) {
  return h("li", {},
    h("div", {}, step.text),
    step.command && h("div", { class: "cmd" },
      h("code", {}, step.command),
      h("button", { on: { click: async (e) => { if (await window.tour.copy(step.command)) e.target.textContent = "Copied"; } } }, "Copy")),
    step.command && i === firstCommand && h("button", { class: "link", on: { click: () => window.tour.openTerminal() } }, "Open Terminal"),
    step.url && h("button", { on: { click: () => window.tour.openUrl(step.url) } }, `Open ${new URL(step.url).hostname}`),
    step.keys && h("div", { class: "keys" }, step.keys.map((provider) => h("button", { on: { click: () => window.tour.addKey(provider) } }, `Paste ${step.keys.length > 1 ? `${KEY_NAMES[provider]} ` : ""}key`))));
}

function guideView() {
  const { guide } = setup;
  const firstCommand = guide.steps.findIndex((step) => step.command);
  return [
    h("button", { class: "link", on: { click: () => { setup = { view: "choices", switching: setup.switching }; render(); } } }, "← Other options"),
    h("h1", {}, guide.title),
    h("ol", { class: "steps" }, guide.steps.map((step, i) => stepView(step, i, firstCommand))),
    h("p", {}, h("button", { class: "primary", disabled: !!setup.checking, on: { click: () => runCheck(setup.id) } }, setup.checking ? "Checking…" : setup.message ? "Check again" : "Done, check it")),
    setup.message && status(setup.message),
  ];
}

function retest() {
  if (setup.id) return runCheck(setup.id);
  setup = { view: "test" };
  stepEvents = {};
  render();
  window.tour.test();
}
function readyView() {
  const failed = stepEvents.failed;
  const testing = setup.view === "test" && !stepEvents.replied && !failed;
  const switchBrain = h("button", { class: "link", on: { click: async () => { info = await window.tour.load(); setup = { view: "choices", switching: true }; stepEvents = {}; render(); } } }, "Use a different brain");
  return [
    h("div", { class: "art" }, "💬"),
    h("h1", {}, "Talk to me"),
    run(() => {
      if (failed) return [status(failed), h("div", { class: "row" }, h("button", { class: "primary", on: { click: retest } }, "Check again"), switchBrain)];
      if (testing) return status(`${info.brain.label} is ready. Asking it to say hi…`);
      return [
        stepEvents.replied ? status("That's me talking. Answers show in my bubble, and I say them out loud.", true) : status(`Answering with ${info.brain.label}.`, true),
        h("p", {}, "Click me, type ", h("b", {}, "hi"), " and press Return."),
        h("p", {}, "From any app, ", keys(info.typeHotkey), " opens the same box."),
        switchBrain,
      ];
    }),
  ];
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
    enter: () => { setup = { view: "choices" }; },
    events: {
      replied: () => { stepEvents = { replied: true }; render(); },
      "reply-failed": (help) => { stepEvents = { failed: help }; render(); },
      "key-closed": async () => {
        if (setup.view === "guide" && setup.guide?.check.kind === "api") return runCheck(setup.id);
        info = await window.tour.load();
        render();
      },
    },
    render: () => run(() => {
      if (setup.view === "guide") return guideView();
      if (info.brain.ready && !setup.switching) return readyView();
      return choicesView();
    }),
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

window.tour.onEvent((name, detail) => STEPS[index]?.events?.[name]?.(detail));
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

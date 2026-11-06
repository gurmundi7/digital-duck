const $ = (id) => document.getElementById(id);
let savedTimer = null;

function option(value, label, selected) {
  const o = document.createElement("option");
  o.value = value; o.textContent = label; o.selected = selected;
  return o;
}

function showErrors(errors) {
  for (const el of document.querySelectorAll("[data-err]")) el.textContent = errors[el.dataset.err] ?? "";
}

let state = null;

async function save(patch) {
  const r = await window.settings.save(patch);
  showErrors(r.errors ?? {});
  if (r.values) { state.values = r.values; state.active = r.active; showBrain(); }
  if (r.ok) {
    $("saved").classList.add("on");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => $("saved").classList.remove("on"), 1200);
  }
}

// The brain section follows the picked provider: its model presets, its key, the levels it can honour.
function showBrain() {
  const v = state.values;
  const byId = Object.fromEntries(state.providers.map((p) => [p.id, p]));
  const p = byId[state.active];
  $("model").value = v.model;
  $("model").placeholder = p.kind === "cli" ? "CLI default" : "";
  $("modelList").replaceChildren(...p.models.filter(([id]) => id).map(([id, label]) => option(id, label, false)));
  $("baseUrlRow").hidden = p.id !== "openai";
  // A CLI with no login of its own uses the matching API key: OpenAI for Codex, Gemini for Gemini CLI.
  const keyOf = p.kind === "api" ? p : byId[p.keyFrom] ?? null;
  $("keyRow").hidden = !keyOf;
  if (keyOf) $("keyLabel").textContent = `${keyOf.label} key`;
  state.keyProvider = keyOf?.id;
  for (const r of document.querySelectorAll("input[name=access]")) r.closest(".level").classList.toggle("off", !p.levels.includes(r.value));
  $("mcpRow").classList.toggle("off", p.kind !== "cli");
  const notes = {
    claude: "Chat runs through your Claude Code.",
    codex: "Chat runs through your Codex CLI (log in once with `codex login`, or save an OpenAI API key).",
    "gemini-cli": "Chat runs through your Gemini CLI (log in once by running `gemini`, or save a Gemini API key).",
    anthropic: "Chat uses an Anthropic API key. It can open things and search the web, but not run commands.",
    openai: "Chat uses an OpenAI API key, or the server at the base URL. It can open things and search the web on OpenAI itself, but not run commands.",
    gemini: "Chat uses a Gemini API key. It can open things and search with Google, but not run commands.",
  };
  const auto = v.provider === "auto" ? `Automatic picked ${p.label}. ` : "";
  const missing = p.kind === "cli" && !p.installed ? `${p.label} isn't installed, so the duck can't answer until it is. ` : "";
  const capped = !p.levels.includes(v.access) ? `It does "${p.levels[p.levels.length - 1]}" at most. ` : "";
  $("brainNote").textContent = `${auto}${missing}${capped}${notes[p.id]}`;
}


async function init() {
  const s = await window.settings.load();
  state = s;
  const v = s.values;
  for (const p of s.providers) {
    const label = p.id === "auto" ? "Automatic (Claude Code, else Anthropic API)" : `${p.label}${p.installed ? "" : " (not installed)"}`;
    $("provider").append(option(p.id, label, p.id === v.provider));
  }
  const english = s.voices.filter((x) => x.lang.startsWith("en"));
  const voices = english.some((x) => x.name === v.voice) ? english : [{ name: v.voice, lang: "" }, ...english];
  for (const x of voices) $("voice").append(option(x.name, x.name, x.name === v.voice));
  $("display").append(option("primary", "Primary display", v.display === "primary"), option("cursor", "Display under the cursor", v.display === "cursor"));
  for (const d of s.displays) $("display").append(option(String(d.id), d.label, String(d.id) === v.display));

  for (const [key, value] of Object.entries(v)) {
    const el = $(key);
    if (!el || el.tagName === "SELECT" && key === "voice") continue;
    if (el.type === "checkbox") el.checked = value; else el.value = value;
  }
  for (const r of document.querySelectorAll("input[name=access]")) r.checked = r.value === v.access;
  $("login").checked = s.login;

  showBrain();

  for (const el of document.querySelectorAll("main select, main input")) {
    if (el.id === "login" || el.id === "provider") continue;
    el.addEventListener("change", () => {
      if (el.name === "access") return save({ access: el.value });
      if (el.type === "checkbox") return save({ [el.id]: el.checked });
      if (el.type === "number") return save({ [el.id]: Number(el.value) });
      return save({ [el.id]: el.value });
    });
  }
  $("login").addEventListener("change", () => window.settings.setLogin($("login").checked));
  $("preview").onclick = () => window.settings.previewVoice($("voice").value, Number($("rate").value));
  $("provider").addEventListener("change", () => save({ provider: $("provider").value }));
  $("key").onclick = () => window.settings.openKey(state.keyProvider);
  $("raw").onclick = () => window.settings.openRaw();
}

init();

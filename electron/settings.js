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

async function save(patch) {
  const r = await window.settings.save(patch);
  showErrors(r.errors ?? {});
  if (r.ok) {
    $("saved").classList.add("on");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => $("saved").classList.remove("on"), 1200);
  }
}

function showFile(p) { $("nudgesFile").textContent = p || "None"; }

async function init() {
  const s = await window.settings.load();
  const v = s.values;
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
  showFile(v["nudges.notificationsFile"]);

  for (const el of document.querySelectorAll("[data-needs-claude]")) el.classList.toggle("off", !s.claude);
  $("brainNote").textContent = s.claude
    ? "Chat runs through your Claude Code."
    : "Claude Code isn't installed, so chat uses an Anthropic API key and can't run anything on your Mac.";

  for (const el of document.querySelectorAll("main select, main input")) {
    if (el.id === "login") continue;
    el.addEventListener("change", () => {
      if (el.name === "access") return save({ access: el.value });
      if (el.type === "checkbox") return save({ [el.id]: el.checked });
      if (el.type === "number") return save({ [el.id]: Number(el.value) });
      return save({ [el.id]: el.value });
    });
  }
  $("login").addEventListener("change", () => window.settings.setLogin($("login").checked));
  $("preview").onclick = () => window.settings.previewVoice($("voice").value, Number($("rate").value));
  $("pickFile").onclick = async () => { const p = await window.settings.pickFile(); if (p) { showFile(p); save({ "nudges.notificationsFile": p }); } };
  $("clearFile").onclick = () => { showFile(""); save({ "nudges.notificationsFile": "" }); };
  $("key").onclick = () => window.settings.openKey();
  $("raw").onclick = () => window.settings.openRaw();
}

init();

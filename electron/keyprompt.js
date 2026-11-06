const $ = (id) => document.getElementById(id);
const status = (t) => { $("status").textContent = t; };
window.keyPrompt.info().then((info) => {
  document.title = `${info.label} key`;
  $("intro").textContent = `The duck can chat through the ${info.label}. Paste ${info.hint} from ${info.url}. It is kept in your login Keychain, never in a file.`;
});
window.keyPrompt.hasKey().then((has) => { if (has) status("A key is saved. Paste a new one to replace it."); });
$("save").onclick = async () => {
  const r = await window.keyPrompt.save($("key").value);
  $("key").value = "";
  if (r.ok) window.close(); else status(r.error);
};
$("remove").onclick = async () => { await window.keyPrompt.remove(); status("Key removed."); };
$("cancel").onclick = () => window.close();
$("key").addEventListener("keydown", (e) => { if (e.key === "Enter") $("save").click(); if (e.key === "Escape") window.close(); });

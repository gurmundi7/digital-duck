// What the duck says out loud is capped at two sentences. The bubble can carry the
// whole text; the voice says the headline and stops. Enforced here, not in the
// persona prompt, so a long briefing or a chatty model cannot talk past it.
const SENTENCE_END = /([.!?…]+["')\]]*)(\s+|$)/g;

function sentencesOf(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index + m[1].length;
    const s = text.slice(last, end).trim();
    if (s) out.push(s);
    last = end + m[2].length;
  }
  const tail = text.slice(last).trim();
  if (tail) out.push(tail);
  return out;
}

function spokenCut(text, { maxSentences = 2, maxChars = 240 } = {}) {
  const clean = String(text ?? "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  let said = sentencesOf(clean).slice(0, maxSentences).join(" ");
  if (said.length > maxChars) {
    const cut = said.lastIndexOf(" ", maxChars - 1);
    said = `${said.slice(0, cut > maxChars / 2 ? cut : maxChars - 1).replace(/[,;:]$/, "")}…`;
  }
  return said;
}

module.exports = { spokenCut, sentencesOf };

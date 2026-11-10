/** Testo pulito e spezzato in frasi corte, così la voce parte subito. */
export function stripForSpeech(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/---/g, "")
    .replace(/⚠️/g, "attenzione")
    .replace(/🔴/g, "")
    .replace(/\[.*?\]\(.*?\)/g, "")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function speechPieces(text: string, maxLen = 380): string[] {
  const clean = stripForSpeech(text).slice(0, 8000);
  if (!clean) return [];

  const sentences = clean.split(/(?<=[.!?;:])\s+/);
  const out: string[] = [];
  let buf = "";

  const pushBuf = () => {
    const piece = buf.trim();
    if (piece) out.push(piece);
    buf = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > maxLen) {
      pushBuf();
      for (let i = 0; i < sentence.length; i += maxLen) {
        out.push(sentence.slice(i, i + maxLen));
      }
      continue;
    }
    const joined = buf ? `${buf} ${sentence}` : sentence;
    if (joined.length > maxLen) {
      pushBuf();
      buf = sentence;
    } else {
      buf = joined;
    }
  }
  pushBuf();
  return out;
}

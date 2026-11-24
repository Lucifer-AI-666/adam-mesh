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

/**
 * Frasi già chiuse da . ! ? e il resto ancora aperto.
 * Non accorpa le frasi: la prima può andare in voce subito.
 */
export function takeClosedPieces(buffer: string, maxLen = 180): { pieces: string[]; rest: string } {
  const pieces: string[] = [];
  let rest = buffer;

  while (rest) {
    const match = rest.match(/^([\s\S]*?[.!?])(?=\s|$)/);
    if (!match) break;
    const sentence = stripForSpeech(match[1]);
    rest = rest.slice(match[1].length).replace(/^\s+/, "");
    if (!sentence) continue;
    if (sentence.length <= maxLen) {
      pieces.push(sentence);
    } else {
      for (let i = 0; i < sentence.length; i += maxLen) {
        pieces.push(sentence.slice(i, i + maxLen));
      }
    }
  }

  if (rest.length >= maxLen) {
    const cut = stripForSpeech(rest.slice(0, maxLen));
    if (cut) pieces.push(cut);
    rest = rest.slice(maxLen).replace(/^\s+/, "");
  }

  return { pieces, rest };
}

export function speechPieces(text: string, maxLen = 180): string[] {
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

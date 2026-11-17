export type VoiceLanguage = "auto" | "it" | "darija";
export const LANGUAGE_POLICY =
  "Lingua: italiano come lingua predefinita. Segui prima la richiesta esplicita dell’utente; altrimenti rispondi nella lingua del suo messaggio, inclusa Darija marocchina in caratteri arabi o latini. Per messaggi misti o ambigui usa italiano salvo scelta esplicita. Non imporre Darija. Mantieni tutte le altre regole di ruolo e sicurezza.";
export function languageInstruction(language: VoiceLanguage = "auto") {
  return (
    LANGUAGE_POLICY +
    (language === "auto"
      ? ""
      : ` Preferenza esplicita corrente: ${language === "it" ? "italiano" : "Darija marocchina naturale"}. Una richiesta linguistica esplicita nel messaggio prevale.`)
  );
}
// xAI documents auto, but not ar-MA: do not pass an invented locale.
export function ttsLanguage(
  language: VoiceLanguage,
  text: string
): "it" | "auto" {
  return language === "it" && !/[\u0600-\u06ff]/.test(text) ? "it" : "auto";
}

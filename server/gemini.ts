/**
 * Gemini API integration for ADAM chat.
 * Uses Google's Generative Language API (v1beta) with gemini-2.0-flash model.
 * La voce non usa più Gemini: vedi generateSpeech (xAI TTS).
 */
import { spawn } from "node:child_process";
import { ENV } from "./_core/env";
import { speechPieces } from "../shared/speechText";
import { piperAvailable, speakPiperPcm } from "./piperVoice";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

interface GeminiResponse {
  candidates: {
    content: {
      parts: { text: string }[];
      role: string;
    };
    finishReason: string;
  }[];
}

/**
 * Call Gemini API for chat completion.
 * Maps our internal message format to Gemini's format.
 */
export async function callGemini(opts: {
  systemPrompt: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  jsonMode?: boolean;
}): Promise<string> {
  const apiKey = ENV.geminiApiKey;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  // Convert messages to Gemini format
  const geminiMessages: GeminiMessage[] = [];
  for (const msg of opts.messages) {
    if (msg.role === "system") continue; // system goes in systemInstruction
    geminiMessages.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }

  // Ensure conversation starts with user message
  if (geminiMessages.length === 0 || geminiMessages[0].role !== "user") {
    geminiMessages.unshift({ role: "user", parts: [{ text: "Ciao" }] });
  }

  const model = "gemini-2.0-flash";
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`;

  const body: any = {
    contents: geminiMessages,
    systemInstruction: {
      parts: [{ text: opts.systemPrompt }],
    },
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens: 2048,
    },
  };

  if (opts.jsonMode) {
    body.generationConfig.responseMimeType = "application/json";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Gemini] API error:", response.status, errorText);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data: GeminiResponse = await response.json();

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error("Gemini returned no candidates");
  }

  return data.candidates[0].content.parts.map(p => p.text).join("");
}

/**
 * Stesso modello della chat, ma a pezzi.
 * Ogni yield è solo il testo nuovo, così la prima frase può andare in voce
 * prima che Gemini abbia finito la risposta.
 */
export async function* streamGeminiText(opts: {
  systemPrompt: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
}): AsyncGenerator<string> {
  const apiKey = ENV.geminiApiKey;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const geminiMessages: GeminiMessage[] = [];
  for (const msg of opts.messages) {
    if (msg.role === "system") continue;
    geminiMessages.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }
  if (geminiMessages.length === 0 || geminiMessages[0].role !== "user") {
    geminiMessages.unshift({ role: "user", parts: [{ text: "Ciao" }] });
  }

  const url = `${GEMINI_BASE_URL}/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: geminiMessages,
      systemInstruction: { parts: [{ text: opts.systemPrompt }] },
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    console.error("[Gemini] stream error:", response.status, errorText.slice(0, 200));
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let data: GeminiResponse;
      try {
        data = JSON.parse(payload);
      } catch {
        continue;
      }
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.text) yield part.text;
      }
    }
  }
}

type ChatTurn = { role: "user" | "assistant" | "system"; content: string };

/**
 * Groq, piano gratuito, modello openai/gpt-oss-20b (~1000 token/s).
 * reasoning_effort low: la prima frase non aspetta un ragionamento lungo.
 * Si parla solo il testo, non il ragionamento.
 */
async function* streamGroqText(opts: {
  systemPrompt: string;
  messages: ChatTurn[];
}, withEffort = true): AsyncGenerator<string> {
  const apiKey = ENV.groqApiKey;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const messages = [
    { role: "system", content: opts.systemPrompt },
    ...opts.messages.filter((msg) => msg.role === "user" || msg.role === "assistant"),
  ];
  const body: Record<string, unknown> = {
    model: "openai/gpt-oss-20b",
    stream: true,
    temperature: 0.4,
    max_tokens: 350,
    messages,
  };
  if (withEffort) body.reasoning_effort = "low";

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    if (withEffort && response.status === 400 && /reasoning/i.test(errorText)) {
      yield* streamGroqText(opts, false);
      return;
    }
    console.error("[Groq] stream error:", response.status, errorText.slice(0, 200));
    throw new Error(`Groq API error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as {
          choices?: { delta?: { content?: string | null } }[];
        };
        const content = data.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        continue;
      }
    }
  }
}

const FREE_CHAT_URL = "https://text.pollinations.ai/openai";

/**
 * API gratuita senza chiave. Risposta intera, poi la prima frase va in voce.
 * Groq e Gemini restano davanti quando c'è una chiave gratuita dell'utente.
 */
async function* streamFreeText(opts: {
  systemPrompt: string;
  messages: ChatTurn[];
}): AsyncGenerator<string> {
  const messages = [
    { role: "system", content: opts.systemPrompt },
    ...opts.messages.filter((msg) => msg.role === "user" || msg.role === "assistant"),
  ];
  const response = await fetch(FREE_CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai",
      stream: false,
      temperature: 0.4,
      messages,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Free] API error:", response.status, errorText.slice(0, 200));
    throw new Error(`Free API error: ${response.status}`);
  }

  const data = await response.json() as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Free API empty");
  yield content;
}

/** Groq se c'è la chiave, poi Gemini, poi l'API gratuita senza chiave. */
export async function* streamAnswerText(opts: {
  systemPrompt: string;
  messages: ChatTurn[];
}): AsyncGenerator<string> {
  if (ENV.groqApiKey) {
    let yielded = false;
    try {
      for await (const delta of streamGroqText(opts)) {
        yielded = true;
        yield delta;
      }
      if (yielded) return;
    } catch (error) {
      console.error("[Groq] Stream fallito:", error);
      if (yielded) return;
    }
  }
  if (ENV.geminiApiKey) {
    yield* streamGeminiText(opts);
    return;
  }
  yield* streamFreeText(opts);
}

/**
 * Classify risk level using Gemini.
 */
export async function classifyRiskWithGemini(
  userMessage: string,
  conversationContext: string
): Promise<"green" | "yellow" | "red"> {
  try {
    const response = await callGemini({
      systemPrompt: `Sei un classificatore di rischio per richieste civiche. Analizza il messaggio dell'utente e classifica il livello di rischio.

Rispondi SOLO con un JSON valido: {"level": "green"} oppure {"level": "yellow"} oppure {"level": "red"}

CRITERI:
- GREEN: informazioni pubbliche, orari, contatti, eventi, indicazioni stradali, informazioni turistiche generali
- YELLOW: procedure burocratiche specifiche, documenti da presentare, scadenze, informazioni che richiedono verifica
- RED: questioni legali, reclami formali, emergenze, richieste di dati personali, situazioni che richiedono intervento umano, problemi con multe/sanzioni, questioni sanitarie urgenti`,
      messages: [
        { role: "user", content: `Contesto conversazione: ${conversationContext}\n\nMessaggio da classificare: ${userMessage}` }
      ],
      jsonMode: true,
    });

    const parsed = JSON.parse(response);
    if (parsed.level === "green" || parsed.level === "yellow" || parsed.level === "red") {
      return parsed.level;
    }
    return "green";
  } catch (error) {
    console.warn("[Gemini] Risk classification failed, defaulting to green:", error);
    return "green";
  }
}

/**
 * Classify the response type for the nebula color spectrum.
 * Returns a semantic type that maps to a nebula color state.
 */
export type ResponseType = "informative" | "empathetic" | "creative" | "navigational" | "important" | "neutral";

export async function classifyResponseType(
  assistantResponse: string,
  userMessage: string
): Promise<ResponseType> {
  try {
    const response = await callGemini({
      systemPrompt: `Sei un classificatore semantico di risposte. Analizza la risposta dell'assistente e il messaggio dell'utente per determinare il TIPO di risposta.

Rispondi SOLO con un JSON valido: {"type": "..."}

TIPI POSSIBILI:
- "informative": risposta con dati, orari, contatti, fatti concreti, spiegazioni tecniche
- "empathetic": risposta che esprime comprensione, supporto emotivo, rassicurazione
- "creative": risposta che propone idee, suggerimenti originali, soluzioni creative
- "navigational": risposta che guida verso un luogo, un ufficio, un percorso, una mappa
- "important": risposta su scadenze urgenti, documenti obbligatori, avvisi critici
- "neutral": saluti, conferme brevi, risposte generiche`,
      messages: [
        { role: "user", content: `Messaggio utente: ${userMessage}\n\nRisposta assistente: ${assistantResponse.slice(0, 500)}` }
      ],
      jsonMode: true,
    });

    const parsed = JSON.parse(response);
    const validTypes: ResponseType[] = ["informative", "empathetic", "creative", "navigational", "important", "neutral"];
    if (validTypes.includes(parsed.type)) {
      return parsed.type;
    }
    return "informative";
  } catch (error) {
    console.warn("[Gemini] Response type classification failed:", error);
    return "informative";
  }
}

/**
 * Voce con xAI TTS.
 * PCM 16 bit, mono, 24000 Hz, lo stesso formato che il browser già suona.
 * Il testo lungo viene spezzato: ogni pezzo è una richiesta corta.
 */
async function speakPiece(text: string, voiceId: string, apiKey: string): Promise<Buffer | null> {
  const response = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      language: "it",
      output_format: { codec: "pcm", sample_rate: 24000 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn("[xAI TTS] API error:", response.status, errorText.slice(0, 200));
    return null;
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 2) return null;
  return audio.length % 2 === 0 ? audio : audio.subarray(0, audio.length - 1);
}

/** WAV di espeak-ng → PCM 16 bit mono 24000 Hz, lo stesso formato del player. */
function wavToPcm24k(wav: Buffer): Buffer | null {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") return null;
  let offset = 12;
  let sampleRate = 22050;
  let channels = 1;
  let bits = 16;
  let data: Buffer | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "data") {
      // espeak-ng su stdout scrive una lunghezza finta (0x7FFFFFFF).
      const available = Math.min(size, Math.max(0, wav.length - start));
      data = wav.subarray(start, start + available - (available % 2));
      break;
    }
    if (start + size > wav.length) break;
    if (id === "fmt " && size >= 16) {
      channels = wav.readUInt16LE(start + 2);
      sampleRate = wav.readUInt32LE(start + 4);
      bits = wav.readUInt16LE(start + 14);
    }
    offset = start + size + (size % 2);
  }
  if (!data || bits !== 16 || channels < 1 || sampleRate < 1000) return null;
  const samples = Math.floor(data.length / (2 * channels));
  if (samples < 1) return null;
  const mono = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += data.readInt16LE((i * channels + channel) * 2);
    }
    mono[i] = Math.max(-32768, Math.min(32767, Math.round(sum / channels)));
  }
  const outLen = Math.max(1, Math.round(samples * 24000 / sampleRate));
  const out = Buffer.alloc(outLen * 2);
  for (let i = 0; i < outLen; i++) {
    const srcPos = (i * sampleRate) / 24000;
    const left = Math.floor(srcPos);
    const right = Math.min(samples - 1, left + 1);
    const frac = srcPos - left;
    const value = mono[left] * (1 - frac) + mono[right] * frac;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), i * 2);
  }
  return out;
}

function speakLocal(text: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = spawn("espeak-ng", ["-v", "it", "-s", "170", "--stdout", text], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, 4000);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      resolve(wavToPcm24k(Buffer.concat(chunks)));
    });
  });
}

export async function generateSpeech(text: string, voiceName: string = "eve"): Promise<string | null> {
  const piece = speechPieces(text)[0];
  if (!piece) return null;

  if (piperAvailable()) {
    try {
      const human = await speakPiperPcm(piece);
      if (human && human.length > 2) return human.toString("base64");
    } catch (error) {
      console.warn("[Voce] Piper fallita:", error);
    }
  }

  const apiKey = ENV.xaiApiKey;
  if (apiKey) {
    const voiceId = /^[a-z0-9]{2,32}$/.test(voiceName) ? voiceName : "eve";
    try {
      const audio = await speakPiece(piece, voiceId, apiKey);
      if (audio) return audio.toString("base64");
    } catch (error) {
      console.warn("[xAI TTS] Pezzo fallito:", error);
    }
  }

  const local = await speakLocal(piece);
  if (!local) {
    console.warn("[Voce] Né xAI né espeak-ng hanno prodotto audio");
    return null;
  }
  return local.toString("base64");
}

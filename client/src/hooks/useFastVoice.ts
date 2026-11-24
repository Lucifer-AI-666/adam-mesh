import { useCallback, useEffect, useRef, useState } from "react";
import { speechPieces } from "../../../shared/speechText";

type FetchAudio = (text: string) => Promise<string | null>;

/**
 * Ogni frase parte appena l'audio è pronto.
 * Sul Pi la voce del browser non emette eventi, quindi si suona il PCM del server:
 * espeak in locale, oppure eve se c'è XAI_API_KEY.
 * La frase successiva si prepara mentre quella corrente suona.
 */
export function useFastVoice(fetchAudio: FetchAudio, rate = 1.08) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isFetchingAudio, setIsFetchingAudio] = useState(false);
  const queueRef = useRef<string[]>([]);
  const tokenRef = useRef(0);
  const activeRef = useRef(false);
  const prefetchRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const speakNextRef = useRef<(token: number) => void>(() => {});
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const stopSource = () => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* già fermo */ }
      sourceRef.current = null;
    }
  };

  const ensureContext = useCallback(() => {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new Ctx({ sampleRate: 24000 });
    }
    return audioCtxRef.current;
  }, []);

  const prime = useCallback(() => {
    const ctx = ensureContext();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }, [ensureContext]);

  const playPcm = useCallback(async (base64Audio: string, onEnded: () => void) => {
    try {
      const ctx = ensureContext();
      if (!ctx) {
        onEnded();
        return;
      }
      if (ctx.state === "suspended") await ctx.resume();

      const binary = atob(base64Audio);
      const byteLength = binary.length - (binary.length % 2);
      const bytes = new Uint8Array(byteLength);
      for (let i = 0; i < byteLength; i++) bytes[i] = binary.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const floats = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768;

      const buffer = ctx.createBuffer(1, floats.length, 24000);
      buffer.getChannelData(0).set(floats);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rateRef.current;
      source.connect(ctx.destination);
      source.onended = () => {
        if (sourceRef.current === source) sourceRef.current = null;
        onEnded();
      };
      sourceRef.current = source;
      source.start();
    } catch (error) {
      console.warn("[Voce] Errore playback:", error);
      onEnded();
    }
  }, [ensureContext]);

  const loadAudio = useCallback((token: number, text: string) => {
    const key = `${token}:${text}`;
    let pending = prefetchRef.current.get(key);
    if (!pending) {
      pending = fetchAudio(text).catch(() => null);
      prefetchRef.current.set(key, pending);
    }
    return pending;
  }, [fetchAudio]);

  const speakNext = useCallback((token: number) => {
    if (token !== tokenRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      activeRef.current = false;
      setIsSpeaking(false);
      setIsFetchingAudio(false);
      return;
    }
    const upcoming = queueRef.current[0];
    if (upcoming) void loadAudio(token, upcoming);
    setIsFetchingAudio(true);
    void loadAudio(token, next).then((audio) => {
      if (token !== tokenRef.current) return;
      setIsFetchingAudio(false);
      if (!audio) {
        speakNextRef.current(token);
        return;
      }
      setIsSpeaking(true);
      void playPcm(audio, () => speakNextRef.current(token));
    });
  }, [loadAudio, playPcm]);

  speakNextRef.current = speakNext;

  const enqueuePieces = useCallback((pieces: string[]) => {
    const clean = pieces.map((piece) => piece.trim()).filter(Boolean);
    if (!clean.length) return;
    queueRef.current.push(...clean);
    if (!activeRef.current) {
      activeRef.current = true;
      tokenRef.current += 1;
      prefetchRef.current.clear();
      speakNext(tokenRef.current);
      return;
    }
    const upcoming = queueRef.current[0];
    if (upcoming) void loadAudio(tokenRef.current, upcoming);
  }, [loadAudio, speakNext]);

  const speakText = useCallback((text: string) => {
    const pieces = speechPieces(text);
    if (!pieces.length) return;
    stopSource();
    queueRef.current = pieces;
    prefetchRef.current.clear();
    activeRef.current = true;
    tokenRef.current += 1;
    setIsSpeaking(true);
    speakNext(tokenRef.current);
  }, [speakNext]);

  const stopSpeaking = useCallback(() => {
    tokenRef.current += 1;
    activeRef.current = false;
    queueRef.current = [];
    prefetchRef.current.clear();
    stopSource();
    setIsSpeaking(false);
    setIsFetchingAudio(false);
  }, []);

  useEffect(() => () => {
    stopSource();
    void audioCtxRef.current?.close();
  }, []);

  return { enqueuePieces, speakText, stopSpeaking, prime, isSpeaking, isFetchingAudio };
}

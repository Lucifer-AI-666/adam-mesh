import { speechPieces } from "../../../shared/speechText";
import type { VoiceLanguage } from "../../../shared/voiceLanguage";
export type PlaybackState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "stopped"
  | "error";
export class SpeechPlayer {
  state: PlaybackState = "idle";
  private token = 0;
  private disposed = false;
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private queue: string[] = [];
  private ready: string | null = null;
  private language: VoiceLanguage = "auto";
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private generate: (
      text: string,
      language: VoiceLanguage
    ) => Promise<string | null>,
    private change: (state: PlaybackState) => void,
    private createContext = () => new AudioContext({ sampleRate: 24000 })
  ) {}
  private set(state: PlaybackState) {
    this.state = state;
    if (!this.disposed) this.change(state);
  }
  play(text: string, language: VoiceLanguage) {
    if (this.disposed) return;
    this.stop();
    this.language = language;
    this.queue = speechPieces(text);
    if (!this.queue.length) return;
    this.set("loading");
    const token = this.token;
    try {
      this.context = this.createContext();
      // Unlock on the Play gesture before waiting for the network.
      void this.context.resume().catch(() => {
        if (token === this.token && !this.disposed) {
          this.stop();
          this.set("error");
        }
      });
      void this.next(token);
    } catch {
      this.stop();
      this.set("error");
    }
  }
  private async next(token: number) {
    if (token !== this.token || this.disposed) return;
    const text = this.queue.shift();
    if (!text) {
      this.stop();
      return;
    }
    if (this.state !== "paused") this.set("loading");
    const language = this.language;
    const request = this.pending
      .catch(() => {})
      .then(() =>
        token === this.token && !this.disposed
          ? this.generate(text, language)
          : null
      );
    this.pending = request;
    try {
      const audio = await request;
      if (token !== this.token || this.disposed) return;
      if (!audio) throw new Error("Audio non disponibile");
      this.ready = audio;
      if (this.state !== "paused") await this.startReady(token);
    } catch {
      if (token === this.token && !this.disposed) {
        this.stop();
        this.set("error");
      }
    }
  }
  private async startReady(token: number) {
    this.context ||= this.createContext();
    const context = this.context;
    await context.resume();
    if (
      token !== this.token ||
      this.disposed ||
      this.state === "paused" ||
      !this.ready
    )
      return;
    const raw = atob(this.ready);
    this.ready = null;
    const samples = new Float32Array(Math.floor(raw.length / 2));
    if (!samples.length) throw new Error("Audio vuoto");
    for (let i = 0; i < samples.length; i++) {
      let n = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
      if (n >= 32768) n -= 65536;
      samples[i] = n / 32768;
    }
    const buffer = context.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.source = source;
    source.onended = () => {
      source.disconnect();
      if (token !== this.token || this.source !== source || this.disposed)
        return;
      this.source = null;
      void this.next(token);
    };
    source.start();
    this.set("playing");
  }
  pause() {
    if (!["loading", "playing"].includes(this.state)) return;
    const token = this.token;
    this.set("paused");
    void this.context?.suspend().catch(() => {
      if (token === this.token && !this.disposed) {
        this.stop();
        this.set("error");
      }
    });
  }
  async resume() {
    if (this.state !== "paused") return;
    const token = this.token;
    this.set(this.source ? "playing" : "loading");
    try {
      if (this.ready) await this.startReady(token);
      else await this.context?.resume();
    } catch {
      if (token === this.token) {
        this.stop();
        this.set("error");
      }
    }
  }
  stop() {
    this.token++;
    this.queue = [];
    this.ready = null;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {}
      this.source.disconnect();
      this.source = null;
    }
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
    this.set("stopped");
  }
  dispose() {
    this.disposed = true;
    this.stop();
  }
}

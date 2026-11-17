import { describe, expect, it, vi } from "vitest";
import { SpeechPlayer } from "../client/src/lib/speechPlayer";
import { speechPieces, stripForSpeech } from "../shared/speechText";
import { languageInstruction, ttsLanguage } from "../shared/voiceLanguage";
import { TtsBudget } from "./ttsBudget";
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { resolve, promise };
};
function fixture(
  generate = vi.fn(async (_text: string, _language: string) => "AAAAAA==")
) {
  const sources: any[] = [],
    contexts: any[] = [];
  const factory = () => {
    const ctx = {
      state: "running",
      destination: {},
      resume: vi.fn(async () => {
        ctx.state = "running";
      }),
      suspend: vi.fn(async () => {
        ctx.state = "suspended";
      }),
      close: vi.fn(async () => {
        ctx.state = "closed";
      }),
      createBuffer: (_c: number, n: number) => ({
        getChannelData: () => new Float32Array(n),
      }),
      createBufferSource: () => {
        const source = {
          buffer: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null as null | (() => void),
        };
        sources.push(source);
        return source;
      },
    };
    contexts.push(ctx);
    return ctx as unknown as AudioContext;
  };
  const player = new SpeechPlayer(generate as any, vi.fn(), factory);
  return { player, sources, contexts, generate };
}
describe("speech playback lifecycle", () => {
  it("plays, pauses preserving context/source, resumes and stops", async () => {
    const f = fixture();
    f.player.play("Ciao.", "it");
    await flush();
    expect(f.player.state).toBe("playing");
    const source = f.sources[0];
    f.player.pause();
    await flush();
    expect(f.player.state).toBe("paused");
    expect(f.contexts[0].state).toBe("suspended");
    expect(source.stop).not.toHaveBeenCalled();
    await f.player.resume();
    expect(f.player.state).toBe("playing");
    expect(f.sources).toHaveLength(1);
    f.player.stop();
    expect(source.stop).toHaveBeenCalledOnce();
    expect(f.player.state).toBe("stopped");
    expect(f.contexts[0].close).toHaveBeenCalledOnce();
  });
  it("ignores late generation after stop; replay starts from beginning", async () => {
    const d = deferred<string>();
    const f = fixture(vi.fn(() => d.promise));
    f.player.play("Ciao", "it");
    await flush();
    f.player.stop();
    d.resolve("AAAAAA==");
    await flush();
    expect(f.sources).toHaveLength(0);
    f.player.play("Ciao", "it");
    await flush();
    expect(f.sources).toHaveLength(1);
    expect(f.generate.mock.calls.map(c => c[0])).toEqual(["Ciao", "Ciao"]);
  });
  it("holds generated audio during pause", async () => {
    const d = deferred<string>();
    const f = fixture(vi.fn(() => d.promise));
    f.player.play("سلام", "darija");
    await flush();
    f.player.pause();
    d.resolve("AAAAAA==");
    await flush();
    expect(f.sources).toHaveLength(0);
    await f.player.resume();
    expect(f.sources).toHaveLength(1);
  });
  it("serializes generation on rapid switching and captures language", async () => {
    const d = deferred<string>();
    const gen = vi
      .fn()
      .mockImplementationOnce(() => d.promise)
      .mockResolvedValue("AAAAAA==");
    const f = fixture(gen);
    f.player.play("prima", "it");
    await flush();
    for (let i = 0; i < 10; i++) {
      f.player.play("vecchia", "it");
      f.player.stop();
    }
    f.player.play("واخا", "darija");
    await flush();
    expect(gen).toHaveBeenCalledTimes(1);
    d.resolve("AAAAAA==");
    await vi.waitFor(() => expect(gen).toHaveBeenCalledTimes(2));
    expect(gen.mock.calls).toEqual([
      ["prima", "it"],
      ["واخا", "darija"],
    ]);
    expect(f.sources).toHaveLength(1);
  });
  it("reads more than 8000 characters in exact segment order", async () => {
    const text = "Questa è una frase lunga per la prova. ".repeat(260);
    const f = fixture();
    f.player.play(text, "it");
    await flush();
    let n = 0;
    while (f.player.state !== "stopped" && n < 100) {
      f.sources[n++].onended?.();
      await flush();
    }
    expect(f.generate.mock.calls.map(c => c[0])).toEqual(speechPieces(text));
    expect(f.generate.mock.calls.map(c => c[0]).join(" ")).toBe(
      stripForSpeech(text)
    );
    expect(f.player.state).toBe("stopped");
  });
  it("does not restart after unmount and exposes generation errors", async () => {
    const d = deferred<string>();
    const f = fixture(vi.fn(() => d.promise));
    f.player.play("Ciao", "it");
    await flush();
    f.player.dispose();
    d.resolve("AAAAAA==");
    await flush();
    expect(f.sources).toHaveLength(0);
    f.player.play("Ciao", "it");
    await flush();
    expect(f.sources).toHaveLength(0);
    const e = fixture(vi.fn().mockRejectedValue(new Error("failure")));
    e.player.play("Ciao", "it");
    await flush();
    expect(e.player.state).toBe("error");
  });
  it("guards against stop while AudioContext.resume is pending", async () => {
    const d = deferred<void>(),
      sources: any[] = [];
    const context: any = {
      state: "suspended",
      resume: () => d.promise,
      close: vi.fn(async () => {}),
      createBufferSource: () => sources.push({}),
    };
    const p = new SpeechPlayer(
      async () => "AAAAAA==",
      () => {},
      () => context
    );
    p.play("Ciao", "it");
    await flush();
    p.stop();
    d.resolve();
    await flush();
    expect(sources).toHaveLength(0);
  });
});
describe("language and cost boundaries", () => {
  it.each([
    ["it", "Buongiorno", "it"],
    ["darija", "سلام، كيف داير؟", "auto"],
    ["darija", "Salam, kif dayr?", "auto"],
    ["auto", "Ciao, labas?", "auto"],
    ["it", "سلام", "auto"],
  ] as const)("%s %s => %s", (lang, text, expected) =>
    expect(ttsLanguage(lang, text)).toBe(expected)
  );
  it("retains Italian default, explicit choice and message override in prompt", () => {
    expect(languageInstruction()).toContain("italiano come lingua predefinita");
    expect(languageInstruction("darija")).toContain(
      "Una richiesta linguistica esplicita nel messaggio prevale"
    );
  });
  it("bounds active TTS, charges characters and releases idempotently", () => {
    let time = 0;
    const b = new TtsBudget(() => time);
    const a = b.acquire(40000)!;
    const c = b.acquire(40000)!;
    expect(b.acquire(1)).toBeNull();
    a();
    a();
    expect(b.acquire(1)).toBeNull();
    time = 60001;
    expect(b.acquire(1)).toBeTypeOf("function");
    expect(b.acquire(1)).toBeNull();
    c();
    expect(b.acquire(1)).toBeTypeOf("function");
  });
});

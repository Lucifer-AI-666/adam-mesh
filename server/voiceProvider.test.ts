import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./_core/env", () => ({ ENV: { xaiApiKey: "mock-key" } }));
import { generateSpeech } from "./gemini";
afterEach(() => vi.unstubAllGlobals());
describe("xAI TTS contract (mock only)", () => {
  it.each(["it", "darija", "auto"] as const)(
    "preserves eve and uses supported language for %s",
    async language => {
      const fetch = vi.fn(
        async () => new Response(new Uint8Array([0, 0, 1, 0]))
      );
      vi.stubGlobal("fetch", fetch);
      expect(
        await generateSpeech("Salam. Kif dayr?", undefined, language)
      ).toBeTruthy();
      const [url, options] = fetch.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      const body = JSON.parse(options.body as string);
      expect(url).toBe("https://api.x.ai/v1/tts");
      expect(body.voice_id).toBe("eve");
      expect(body.language).toBe(language === "it" ? "it" : "auto");
      expect(body.output_format).toEqual({ codec: "pcm", sample_rate: 24000 });
    }
  );
  it("fails visibly instead of skipping an unsuccessful segment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("failure", { status: 500 }))
    );
    expect(await generateSpeech("Ciao")).toBeNull();
  });
});

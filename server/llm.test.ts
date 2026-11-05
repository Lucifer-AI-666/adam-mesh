import { afterEach, describe, expect, it, vi } from "vitest";

process.env.LLM_API_KEY = "test-key";
process.env.LLM_API_URL = "https://llm.example.com/v1/";
process.env.LLM_MODEL = "test-model";

describe("invokeLLM", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls the configured OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { invokeLLM } = await import("./_core/llm");
    await invokeLLM({ messages: [{ role: "user", content: "ciao" }] });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string).model).toBe("test-model");
  });
});

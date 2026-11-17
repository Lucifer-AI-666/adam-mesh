import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  getConversationById: vi.fn(),
  getConversationMessages: vi.fn(),
  getUserConversations: vi.fn(),
  createConversation: vi.fn(),
  addMessage: vi.fn(),
  searchKnowledge: vi.fn(),
  createEscalation: vi.fn(),
  updateConversation: vi.fn(),
  getAllNodes: vi.fn(),
  getNodeById: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
  getEscalations: vi.fn(),
  getEscalationsByOperator: vi.fn(),
  updateEscalation: vi.fn(),
  getAllKnowledge: vi.fn(),
  addKnowledgeEntry: vi.fn(),
  updateKnowledgeEntry: vi.fn(),
  deleteKnowledgeEntry: vi.fn(),
  getSetting: vi.fn(),
  getAllSettings: vi.fn(),
  upsertSetting: vi.fn(),
  deleteSetting: vi.fn(),
  getConversationStats: vi.fn(),
  getDailyConversationCounts: vi.fn(),
  getRecentCrawlLogs: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  addCrawlLog: vi.fn(),
}));

vi.mock("./gemini", () => ({
  callGemini: vi.fn(async () => "Risposta di test"),
  classifyRiskWithGemini: vi.fn(async () => "green" as const),
  classifyResponseType: vi.fn(async () => "neutral"),
  generateSpeech: vi.fn(),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(),
}));

import * as db from "./db";
import { appRouter } from "./routers";

import { callGemini, generateSpeech } from "./gemini";
const context = {
  user: null,
  req: { protocol: "https", headers: {} },
  res: {},
} as TrpcContext;
describe("voice router integration (mock)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.createConversation).mockResolvedValue(1);
    vi.mocked(db.getConversationMessages).mockResolvedValue([]);
    vi.mocked(db.searchKnowledge).mockResolvedValue([]);
    vi.mocked(db.getSetting).mockResolvedValue(
      "REGOLE CUSTOM: non inventare dati. Rispondi in italiano."
    );
  });
  it.each(["auto", "it", "darija"] as const)(
    "appends language %s without writing custom DB prompt",
    async language => {
      await appRouter
        .createCaller(context)
        .chat.send({ message: "Salam, spiegami i passaggi", language });
      const prompt = vi.mocked(callGemini).mock.calls[0][0].systemPrompt;
      expect(prompt).toContain("REGOLE CUSTOM: non inventare dati.");
      expect(prompt).toContain("italiano come lingua predefinita");
      if (language === "darija")
        expect(prompt).toContain("Preferenza esplicita corrente: Darija");
      expect(db.upsertSetting).not.toHaveBeenCalled();
    }
  );
  it("passes Darija to TTS and preserves default eve", async () => {
    vi.mocked(generateSpeech).mockResolvedValue("AAAAAA==");
    await appRouter
      .createCaller(context)
      .chat.speak({ text: "سلام", language: "darija" });
    expect(generateSpeech).toHaveBeenCalledWith("سلام", "eve", "darija");
  });
  it("rejects unsupported language before TTS", async () => {
    await expect(
      appRouter
        .createCaller(context)
        .chat.speak({ text: "Ciao", language: "invalid" as any })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(generateSpeech).not.toHaveBeenCalled();
  });
});

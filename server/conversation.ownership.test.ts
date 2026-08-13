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

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function authCtx(
  id: number,
  role: "user" | "operator" | "admin" = "user"
): TrpcContext {
  const user: AuthenticatedUser = {
    id,
    openId: `user-${id}`,
    email: `user${id}@example.com`,
    name: `User ${id}`,
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function guestCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const ownedConv = {
  id: 100,
  userId: 10,
  channel: "web",
  status: "active",
  title: "Owner chat",
  riskLevel: "green",
  createdAt: new Date(),
  updatedAt: new Date(),
  resolvedAt: null,
};

const guestConv = {
  id: 200,
  userId: null,
  channel: "web",
  status: "active",
  title: "Guest chat",
  riskLevel: "green",
  createdAt: new Date(),
  updatedAt: new Date(),
  resolvedAt: null,
};

const messages = [
  {
    id: 1,
    conversationId: 100,
    role: "user",
    content: "ciao",
    riskLevel: null,
    createdAt: new Date(),
  },
];

describe("ADAM - Conversation ownership (IDOR)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getConversationById).mockResolvedValue(ownedConv as any);
    vi.mocked(db.getConversationMessages).mockResolvedValue(messages as any);
    vi.mocked(db.searchKnowledge).mockResolvedValue([] as any);
    vi.mocked(db.getSetting).mockResolvedValue(null);
    vi.mocked(db.addMessage).mockResolvedValue(1 as any);
    vi.mocked(db.updateConversation).mockResolvedValue(undefined as any);
  });

  describe("chat.getConversation", () => {
    it("allows the owner (positive)", async () => {
      const caller = appRouter.createCaller(authCtx(10, "user"));
      const result = await caller.chat.getConversation({ conversationId: 100 });
      expect(result).toEqual(messages);
      expect(db.getConversationById).toHaveBeenCalledWith(100);
      expect(db.getConversationMessages).toHaveBeenCalledWith(100);
    });

    it("rejects another user (negative IDOR)", async () => {
      const caller = appRouter.createCaller(authCtx(99, "user"));
      await expect(
        caller.chat.getConversation({ conversationId: 100 })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      } satisfies Partial<TRPCError>);
      expect(db.getConversationMessages).not.toHaveBeenCalled();
    });

    it("allows admin staff (positive)", async () => {
      const caller = appRouter.createCaller(authCtx(1, "admin"));
      const result = await caller.chat.getConversation({ conversationId: 100 });
      expect(result).toEqual(messages);
      expect(db.getConversationMessages).toHaveBeenCalledWith(100);
    });

    it("allows operator staff (positive)", async () => {
      const caller = appRouter.createCaller(authCtx(2, "operator"));
      const result = await caller.chat.getConversation({ conversationId: 100 });
      expect(result).toEqual(messages);
      expect(db.getConversationMessages).toHaveBeenCalledWith(100);
    });

    it("rejects unauthenticated with UNAUTHORIZED (negative)", async () => {
      const caller = appRouter.createCaller(guestCtx());
      await expect(
        caller.chat.getConversation({ conversationId: 100 })
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(db.getConversationById).not.toHaveBeenCalled();
      expect(db.getConversationMessages).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when missing (negative)", async () => {
      vi.mocked(db.getConversationById).mockResolvedValue(undefined);
      const caller = appRouter.createCaller(authCtx(10, "user"));
      await expect(
        caller.chat.getConversation({ conversationId: 999 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(db.getConversationMessages).not.toHaveBeenCalled();
    });
  });

  describe("chat.exportConversation", () => {
    it("allows the owner (positive)", async () => {
      const caller = appRouter.createCaller(authCtx(10, "user"));
      const result = await caller.chat.exportConversation({
        conversationId: 100,
      });
      expect(result.conversation).toEqual(ownedConv);
      expect(result.messages).toEqual(messages);
      expect(db.getConversationMessages).toHaveBeenCalledWith(100);
    });

    it("rejects another user (negative IDOR)", async () => {
      const caller = appRouter.createCaller(authCtx(99, "user"));
      await expect(
        caller.chat.exportConversation({ conversationId: 100 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.getConversationMessages).not.toHaveBeenCalled();
    });

    it("allows admin (positive)", async () => {
      const caller = appRouter.createCaller(authCtx(1, "admin"));
      const result = await caller.chat.exportConversation({
        conversationId: 100,
      });
      expect(result.conversation).toEqual(ownedConv);
      expect(result.messages).toEqual(messages);
      expect(db.getConversationMessages).toHaveBeenCalledWith(100);
    });

    it("allows operator (positive)", async () => {
      const caller = appRouter.createCaller(authCtx(2, "operator"));
      const result = await caller.chat.exportConversation({
        conversationId: 100,
      });
      expect(result.conversation).toEqual(ownedConv);
      expect(result.messages).toEqual(messages);
      expect(db.getConversationMessages).toHaveBeenCalledWith(100);
    });

    it("returns NOT_FOUND when conversation is missing", async () => {
      vi.mocked(db.getConversationById).mockResolvedValue(undefined);
      const caller = appRouter.createCaller(authCtx(10, "user"));
      await expect(
        caller.chat.exportConversation({ conversationId: 999 })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(db.getConversationMessages).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated with UNAUTHORIZED (negative)", async () => {
      const caller = appRouter.createCaller(guestCtx());
      await expect(
        caller.chat.exportConversation({ conversationId: 100 })
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(db.getConversationById).not.toHaveBeenCalled();
      expect(db.getConversationMessages).not.toHaveBeenCalled();
    });
  });

  describe("chat.send + conversationId", () => {
    it("allows guest to continue an unowned (userId null) conversation", async () => {
      vi.mocked(db.getConversationById).mockResolvedValue(guestConv as any);
      vi.mocked(db.getConversationMessages).mockResolvedValue([] as any);

      const caller = appRouter.createCaller(guestCtx());
      const result = await caller.chat.send({
        conversationId: 200,
        message: "ciao da guest",
      });

      expect(result.conversationId).toBe(200);
      expect(db.getConversationById).toHaveBeenCalledWith(200);
      expect(db.addMessage).toHaveBeenCalled();
    });

    it("rejects guest appending to a user-owned conversation (negative)", async () => {
      vi.mocked(db.getConversationById).mockResolvedValue(ownedConv as any);

      const caller = appRouter.createCaller(guestCtx());
      await expect(
        caller.chat.send({
          conversationId: 100,
          message: "tentativo guest",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(db.addMessage).not.toHaveBeenCalled();
    });

    it("rejects authenticated non-owner (negative IDOR)", async () => {
      vi.mocked(db.getConversationById).mockResolvedValue(ownedConv as any);

      const caller = appRouter.createCaller(authCtx(99, "user"));
      await expect(
        caller.chat.send({
          conversationId: 100,
          message: "non mia",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(db.addMessage).not.toHaveBeenCalled();
    });

    it("allows owner to continue their conversation (positive)", async () => {
      vi.mocked(db.getConversationById).mockResolvedValue(ownedConv as any);
      vi.mocked(db.getConversationMessages).mockResolvedValue([] as any);

      const caller = appRouter.createCaller(authCtx(10, "user"));
      const result = await caller.chat.send({
        conversationId: 100,
        message: "secondo messaggio",
      });

      expect(result.conversationId).toBe(100);
      expect(db.addMessage).toHaveBeenCalled();
    });

    it("does not let authenticated user claim a guest conversation (negative)", async () => {
      vi.mocked(db.getConversationById).mockResolvedValue(guestConv as any);

      const caller = appRouter.createCaller(authCtx(10, "user"));
      await expect(
        caller.chat.send({
          conversationId: 200,
          message: "cerco di appropriarmi",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(db.addMessage).not.toHaveBeenCalled();
    });

    it("allows operator staff to continue a user-owned conversation (positive)", async () => {
      vi.mocked(db.getConversationById).mockResolvedValue(ownedConv as any);
      vi.mocked(db.getConversationMessages).mockResolvedValue([] as any);

      const caller = appRouter.createCaller(authCtx(2, "operator"));
      const result = await caller.chat.send({
        conversationId: 100,
        message: "supporto operatore",
      });

      expect(result.conversationId).toBe(100);
      expect(db.addMessage).toHaveBeenCalled();
    });

    it("returns NOT_FOUND when conversationId is missing (negative)", async () => {
      vi.mocked(db.getConversationById).mockResolvedValue(undefined);

      const caller = appRouter.createCaller(authCtx(10, "user"));
      await expect(
        caller.chat.send({
          conversationId: 999,
          message: "ghost",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(db.addMessage).not.toHaveBeenCalled();
    });
  });
});

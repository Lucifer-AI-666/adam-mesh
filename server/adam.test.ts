import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(role: "user" | "operator" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-123",
    email: "test@example.com",
    name: "Test User",
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

describe("ADAM - Auth", () => {
  it("returns null for unauthenticated user", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user data for authenticated user", async () => {
    const ctx = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).not.toBeNull();
    expect(result?.name).toBe("Test User");
    expect(result?.role).toBe("admin");
  });
});

describe("ADAM - Nodes", () => {
  it("lists nodes publicly", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.nodes.list({});
    expect(Array.isArray(result)).toBe(true);
  });

  it("rejects node creation for non-admin", async () => {
    const ctx = createAuthContext("user");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.nodes.create({
        name: "Test Node",
        type: "institutional",
      })
    ).rejects.toThrow();
  });
});

describe("ADAM - Escalations", () => {
  it("rejects escalation list for unauthenticated user", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.escalations.list()).rejects.toThrow();
  });

  it("allows escalation list for operator", async () => {
    const ctx = createAuthContext("operator");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.escalations.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("ADAM - Knowledge Base", () => {
  it("rejects knowledge list for non-admin", async () => {
    const ctx = createAuthContext("user");
    const caller = appRouter.createCaller(ctx);
    await expect(caller.knowledge.list()).rejects.toThrow();
  });

  it("allows knowledge list for admin", async () => {
    const ctx = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.knowledge.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("ADAM - Analytics", () => {
  // analytics.stats is publicProcedure (Home/Dashboard use it for authenticated users).
  it("allows analytics stats for operator", async () => {
    const ctx = createAuthContext("operator");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.analytics.stats();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("green");
    expect(result).toHaveProperty("yellow");
    expect(result).toHaveProperty("red");
  });

  it("allows analytics stats for admin", async () => {
    const ctx = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.analytics.stats();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("green");
    expect(result).toHaveProperty("yellow");
    expect(result).toHaveProperty("red");
  });

  it("rejects crawl logs for non-admin", async () => {
    const ctx = createAuthContext("operator");
    const caller = appRouter.createCaller(ctx);
    await expect(caller.analytics.crawlLogs()).rejects.toThrow();
  });
});

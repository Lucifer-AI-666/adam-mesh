import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-for-vitest";

type Row = Record<string, any>;
const rows: Row[] = [];

vi.mock("./db", () => {
  class DuplicateEmailError extends Error {}
  return {
    DuplicateEmailError,
    getUserByEmail: async (email: string) => rows.find((r) => r.email === email),
    getUserByOpenId: async (openId: string) => rows.find((r) => r.openId === openId),
    upsertUser: async () => {},
    createLocalUser: async (input: Row) => {
      if (rows.some((r) => r.email === input.email)) throw new DuplicateEmailError();
      const row = {
        id: rows.length + 1,
        openId: `local_${rows.length + 1}`,
        loginMethod: "password",
        role: "user",
        lastSignedIn: new Date(),
        ...input,
      };
      rows.push(row);
      return row;
    },
  };
});

describe("local auth routes", () => {
  let server: Server;
  let base: string;

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    const { registerAuthRoutes } = await import("./_core/auth");
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("registers, rejects duplicates, logs in and resolves /me", async () => {
    const reg = await post("/api/auth/register", { email: "Ada@Example.com", password: "supersecret1" });
    expect(reg.status).toBe(200);
    const { app_session_id, user } = await reg.json();
    expect(user.email).toBe("ada@example.com");
    expect(user).not.toHaveProperty("passwordHash");

    expect((await post("/api/auth/register", { email: "ada@example.com", password: "supersecret1" })).status).toBe(409);

    const login = await post("/api/auth/login", { email: "ada@example.com", password: "supersecret1" });
    expect(login.status).toBe(200);

    const me = await fetch(base + "/api/auth/me", {
      headers: { Authorization: `Bearer ${app_session_id}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()).user.email).toBe("ada@example.com");
  });

  it("rejects bad credentials, weak passwords and unauthenticated /me", async () => {
    expect((await post("/api/auth/login", { email: "ada@example.com", password: "wrongpass1" })).status).toBe(401);
    expect((await post("/api/auth/login", { email: "nobody@example.com", password: "wrongpass1" })).status).toBe(401);
    expect((await post("/api/auth/register", { email: "b@example.com", password: "short" })).status).toBe(400);
    expect((await fetch(base + "/api/auth/me")).status).toBe(401);
  });
});

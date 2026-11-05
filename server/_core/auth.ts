import { COOKIE_NAME, SESSION_TTL_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { User } from "../../drizzle/schema";
import { DuplicateEmailError, createLocalUser, getUserByEmail } from "../db";
import { getSessionCookieOptions } from "./cookies";
import { hashPassword, verifyPassword } from "./password";
import { sdk } from "./sdk";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(128),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(100).optional(),
});

// Placeholder hash so login takes the same time whether or not the email exists.
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function buildUserResponse(user: User) {
  return {
    id: user.id,
    openId: user.openId,
    name: user.name ?? null,
    email: user.email ?? null,
    loginMethod: user.loginMethod ?? null,
    lastSignedIn: (user.lastSignedIn ?? new Date()).toISOString(),
  };
}

async function startSession(req: Request, res: Response, user: User) {
  const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name ?? "" });
  res.cookie(COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge: SESSION_TTL_MS,
  });
  res.json({ app_session_id: sessionToken, user: buildUserResponse(user) });
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Valid email and password (min 8 chars) are required" });
      return;
    }
    if (isRateLimited(`register:${req.ip}`)) {
      res.status(429).json({ error: "Too many attempts, try again later" });
      return;
    }

    const { email, password, name } = parsed.data;
    try {
      const user = await createLocalUser({
        email,
        name: name ?? email.split("@")[0],
        passwordHash: await hashPassword(password),
      });
      await startSession(req, res, user);
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
      console.error("[Auth] Register failed", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    const { email, password } = parsed.data;
    if (isRateLimited(`login:${req.ip}:${email}`)) {
      res.status(429).json({ error: "Too many attempts, try again later" });
      return;
    }

    try {
      const user = await getUserByEmail(email);
      const valid = await verifyPassword(
        password,
        user?.passwordHash ?? (await DUMMY_HASH),
      );
      if (!user || !user.passwordHash || !valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      await startSession(req, res, user);
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: -1 });
    res.json({ success: true });
  });

  // Works with both cookie (web) and Bearer token (mobile).
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: buildUserResponse(user) });
    } catch {
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });

  // Turns a valid Bearer token into a session cookie (used by embedded web previews).
  app.post("/api/auth/session", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const token = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
      if (!token) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      res.cookie(COOKIE_NAME, token, {
        ...getSessionCookieOptions(req),
        maxAge: SESSION_TTL_MS,
      });
      res.json({ success: true, user: buildUserResponse(user) });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });
}

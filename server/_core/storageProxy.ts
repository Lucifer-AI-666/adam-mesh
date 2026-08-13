import type { Express, Request, Response } from "express";
import type { User } from "../../drizzle/schema";
import {
  canAccessStorageKey,
  isAllowedRedirectUrl,
  normalizeAndValidateStorageKey,
} from "../storageAccess";
import { ENV } from "./env";
import { sdk } from "./sdk";

export type StorageProxyResult =
  | { kind: "redirect"; url: string }
  | { kind: "error"; status: number; body: string };

export type StorageProxyDeps = {
  authenticate: (req: Request) => Promise<User>;
  isConfigured: () => boolean;
  /** Request a presigned GET URL for a validated key. Must not be called after deny. */
  forgePresignGet: (key: string) => Promise<string | null>;
};

function defaultIsConfigured(): boolean {
  return Boolean(ENV.forgeApiUrl && ENV.forgeApiKey);
}

async function defaultForgePresignGet(key: string): Promise<string | null> {
  const forgeUrl = new URL(
    "v1/storage/presign/get",
    ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
  );
  forgeUrl.searchParams.set("path", key);

  const forgeResp = await fetch(forgeUrl, {
    headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
  });

  if (!forgeResp.ok) {
    const body = await forgeResp.text().catch(() => "");
    console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
    return null;
  }

  const { url } = (await forgeResp.json()) as { url?: string };
  return url ?? null;
}

/**
 * Pure-ish request pipeline for GET /manus-storage/*.
 * Unit-tested with injected deps; no Express coupling beyond Request shape.
 */
export async function handleStorageProxyRequest(
  rawKey: string | undefined,
  req: Request,
  deps: StorageProxyDeps
): Promise<StorageProxyResult> {
  // 1. Auth first — no forge call without a session
  let user: User;
  try {
    user = await deps.authenticate(req);
  } catch {
    return { kind: "error", status: 401, body: "Unauthorized" };
  }

  // 2. Path validation — reject traversal / schemes before any backend call
  const key = normalizeAndValidateStorageKey(rawKey);
  if (!key) {
    return { kind: "error", status: 400, body: "Invalid storage key" };
  }

  // 3. Ownership / role
  if (!canAccessStorageKey(user, key)) {
    return { kind: "error", status: 403, body: "Forbidden" };
  }

  // 4. Config
  if (!deps.isConfigured()) {
    return { kind: "error", status: 500, body: "Storage proxy not configured" };
  }

  // 5. Presign + redirect URL safety (SSRF on redirect target)
  let signedUrl: string | null;
  try {
    signedUrl = await deps.forgePresignGet(key);
  } catch (err) {
    console.error("[StorageProxy] forge failed:", err);
    return { kind: "error", status: 502, body: "Storage proxy error" };
  }

  if (!signedUrl) {
    return { kind: "error", status: 502, body: "Storage backend error" };
  }

  if (!isAllowedRedirectUrl(signedUrl)) {
    console.error("[StorageProxy] blocked unsafe redirect URL");
    return { kind: "error", status: 502, body: "Unsafe storage redirect" };
  }

  return { kind: "redirect", url: signedUrl };
}

export function registerStorageProxy(
  app: Express,
  deps: Partial<StorageProxyDeps> = {}
) {
  const resolved: StorageProxyDeps = {
    authenticate: deps.authenticate ?? (req => sdk.authenticateRequest(req)),
    isConfigured: deps.isConfigured ?? defaultIsConfigured,
    forgePresignGet: deps.forgePresignGet ?? defaultForgePresignGet,
  };

  app.get("/manus-storage/*", async (req: Request, res: Response) => {
    const rawKey = (req.params as Record<string, string>)[0];
    const result = await handleStorageProxyRequest(rawKey, req, resolved);

    if (result.kind === "redirect") {
      res.set("Cache-Control", "no-store");
      res.redirect(307, result.url);
      return;
    }

    res.status(result.status).send(result.body);
  });
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { User } from "../drizzle/schema";
import { handleStorageProxyRequest } from "./_core/storageProxy";

function user(id: number, role: "user" | "operator" | "admin" = "user"): User {
  return {
    id,
    openId: `u-${id}`,
    email: `u${id}@example.com`,
    name: `User ${id}`,
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

function req(): Request {
  return { headers: {}, protocol: "https" } as Request;
}

describe("ADAM - Storage proxy hardening", () => {
  const forgePresignGet = vi.fn();
  const authenticate = vi.fn();
  const isConfigured = vi.fn(() => true);

  beforeEach(() => {
    vi.clearAllMocks();
    isConfigured.mockReturnValue(true);
    forgePresignGet.mockResolvedValue(
      "https://cdn.example.com/bucket/object?sig=1"
    );
    authenticate.mockResolvedValue(user(10, "user"));
  });

  const deps = () => ({
    authenticate,
    isConfigured,
    forgePresignGet,
  });

  it("allows owner to read namespaced key (positive)", async () => {
    const result = await handleStorageProxyRequest(
      "10-files/photo.png",
      req(),
      deps()
    );
    expect(result).toEqual({
      kind: "redirect",
      url: "https://cdn.example.com/bucket/object?sig=1",
    });
    expect(forgePresignGet).toHaveBeenCalledWith("10-files/photo.png");
  });

  it("rejects other user (negative) without calling forge", async () => {
    authenticate.mockResolvedValue(user(99, "user"));
    const result = await handleStorageProxyRequest(
      "10-files/photo.png",
      req(),
      deps()
    );
    expect(result).toEqual({
      kind: "error",
      status: 403,
      body: "Forbidden",
    });
    expect(forgePresignGet).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated without calling forge (negative)", async () => {
    authenticate.mockRejectedValue(new Error("no session"));
    const result = await handleStorageProxyRequest(
      "10-files/photo.png",
      req(),
      deps()
    );
    expect(result).toEqual({
      kind: "error",
      status: 401,
      body: "Unauthorized",
    });
    expect(forgePresignGet).not.toHaveBeenCalled();
  });

  it("rejects path traversal without calling forge (negative)", async () => {
    const result = await handleStorageProxyRequest(
      "../etc/passwd",
      req(),
      deps()
    );
    expect(result).toEqual({
      kind: "error",
      status: 400,
      body: "Invalid storage key",
    });
    expect(forgePresignGet).not.toHaveBeenCalled();
  });

  it("rejects scheme-like keys without calling forge (negative)", async () => {
    const result = await handleStorageProxyRequest(
      "https://evil.com/x",
      req(),
      deps()
    );
    expect(result.status).toBe(400);
    expect(forgePresignGet).not.toHaveBeenCalled();
  });

  it("allows admin staff on any key (positive)", async () => {
    authenticate.mockResolvedValue(user(1, "admin"));
    const result = await handleStorageProxyRequest(
      "generated/1.png",
      req(),
      deps()
    );
    expect(result.kind).toBe("redirect");
    expect(forgePresignGet).toHaveBeenCalledWith("generated/1.png");
  });

  it("allows operator staff on any key (positive)", async () => {
    authenticate.mockResolvedValue(user(2, "operator"));
    const result = await handleStorageProxyRequest(
      "99-files/x.png",
      req(),
      deps()
    );
    expect(result.kind).toBe("redirect");
    expect(forgePresignGet).toHaveBeenCalled();
  });

  it("denies non-staff generated/ keys without calling forge", async () => {
    const result = await handleStorageProxyRequest(
      "generated/1.png",
      req(),
      deps()
    );
    expect(result).toEqual({
      kind: "error",
      status: 403,
      body: "Forbidden",
    });
    expect(forgePresignGet).not.toHaveBeenCalled();
  });

  it("allows authenticated user on public/ prefix", async () => {
    const result = await handleStorageProxyRequest(
      "public/logo.png",
      req(),
      deps()
    );
    expect(result.kind).toBe("redirect");
    expect(forgePresignGet).toHaveBeenCalledWith("public/logo.png");
  });

  it("blocks unsafe forge redirect (localhost) without following", async () => {
    forgePresignGet.mockResolvedValue("https://127.0.0.1/secret");
    const result = await handleStorageProxyRequest(
      "10-files/photo.png",
      req(),
      deps()
    );
    expect(result).toEqual({
      kind: "error",
      status: 502,
      body: "Unsafe storage redirect",
    });
  });

  it("blocks private IP redirect", async () => {
    forgePresignGet.mockResolvedValue("https://10.0.0.8/x");
    const result = await handleStorageProxyRequest(
      "10-files/photo.png",
      req(),
      deps()
    );
    expect(result.status).toBe(502);
    expect(result.kind === "error" && result.body).toBe(
      "Unsafe storage redirect"
    );
  });

  it("blocks cloud metadata redirect", async () => {
    forgePresignGet.mockResolvedValue(
      "https://169.254.169.254/latest/meta-data"
    );
    const result = await handleStorageProxyRequest(
      "10-files/photo.png",
      req(),
      deps()
    );
    expect(result.status).toBe(502);
  });

  it("returns 502 when forge fails (no crash)", async () => {
    forgePresignGet.mockResolvedValue(null);
    const result = await handleStorageProxyRequest(
      "10-files/photo.png",
      req(),
      deps()
    );
    expect(result).toEqual({
      kind: "error",
      status: 502,
      body: "Storage backend error",
    });
  });

  it("returns 500 when storage is not configured without calling forge", async () => {
    isConfigured.mockReturnValue(false);
    const result = await handleStorageProxyRequest(
      "10-files/photo.png",
      req(),
      deps()
    );
    expect(result).toEqual({
      kind: "error",
      status: 500,
      body: "Storage proxy not configured",
    });
    expect(forgePresignGet).not.toHaveBeenCalled();
  });
});

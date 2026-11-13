import { beforeAll, describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-for-vitest";

describe("password hashing", () => {
  it("verifies the correct password and rejects others", async () => {
    const { hashPassword, verifyPassword } = await import("./_core/password");
    const hash = await hashPassword("correct horse battery");

    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
    expect(await verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });
});

describe("session tokens", () => {
  let sdk: typeof import("./_core/sdk").sdk;

  beforeAll(async () => {
    ({ sdk } = await import("./_core/sdk"));
  });

  it("round-trips a signed session", async () => {
    const token = await sdk.createSessionToken("local_abc", { name: "Ada" });
    expect(await sdk.verifySession(token)).toMatchObject({ openId: "local_abc", name: "Ada" });
  });

  it("rejects tampered and expired tokens", async () => {
    const token = await sdk.createSessionToken("local_abc");
    expect(await sdk.verifySession(token + "x")).toBeNull();

    const expired = await sdk.createSessionToken("local_abc", { expiresInMs: -60_000 });
    expect(await sdk.verifySession(expired)).toBeNull();
    expect(await sdk.verifySession(undefined)).toBeNull();
  });
});

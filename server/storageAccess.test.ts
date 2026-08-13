import { describe, expect, it } from "vitest";
import {
  canAccessStorageKey,
  isAllowedRedirectUrl,
  normalizeAndValidateStorageKey,
} from "./storageAccess";

const owner = { id: 10, role: "user" };
const other = { id: 99, role: "user" };
const admin = { id: 1, role: "admin" };
const operator = { id: 2, role: "operator" };

describe("normalizeAndValidateStorageKey", () => {
  it("accepts normal relative keys", () => {
    expect(normalizeAndValidateStorageKey("10-files/photo_abc.png")).toBe(
      "10-files/photo_abc.png"
    );
    expect(normalizeAndValidateStorageKey("public/logo.png")).toBe(
      "public/logo.png"
    );
  });

  it("strips leading slashes", () => {
    expect(normalizeAndValidateStorageKey("/10-files/a.png")).toBe(
      "10-files/a.png"
    );
  });

  it("rejects empty and missing", () => {
    expect(normalizeAndValidateStorageKey("")).toBeNull();
    expect(normalizeAndValidateStorageKey(null)).toBeNull();
    expect(normalizeAndValidateStorageKey(undefined)).toBeNull();
    expect(normalizeAndValidateStorageKey("///")).toBeNull();
  });

  it("rejects path traversal", () => {
    expect(normalizeAndValidateStorageKey("../etc/passwd")).toBeNull();
    expect(normalizeAndValidateStorageKey("a/../../b")).toBeNull();
    expect(normalizeAndValidateStorageKey("a/./b")).toBeNull();
    expect(normalizeAndValidateStorageKey("a//b")).toBeNull();
  });

  it("rejects backslash and encoded traversal", () => {
    expect(normalizeAndValidateStorageKey("a\\..\\b")).toBeNull();
    expect(normalizeAndValidateStorageKey("%2e%2e/secret")).toBeNull();
  });

  it("rejects schemes and protocol-relative paths", () => {
    expect(normalizeAndValidateStorageKey("https://evil.com/x")).toBeNull();
    expect(normalizeAndValidateStorageKey("file:///etc/passwd")).toBeNull();
    expect(normalizeAndValidateStorageKey("//evil.com/x")).toBeNull();
  });

  it("rejects unsafe characters", () => {
    expect(normalizeAndValidateStorageKey("a b.png")).toBeNull();
    expect(normalizeAndValidateStorageKey("a?x=1")).toBeNull();
    expect(normalizeAndValidateStorageKey("a#frag")).toBeNull();
  });
});

describe("canAccessStorageKey", () => {
  it("allows owner on namespaced key (positive)", () => {
    expect(canAccessStorageKey(owner, "10-files/photo.png")).toBe(true);
    expect(canAccessStorageKey(owner, "10/photo.png")).toBe(true);
    expect(canAccessStorageKey(owner, "10_photo.png")).toBe(true);
  });

  it("denies other user on owner namespace (negative)", () => {
    expect(canAccessStorageKey(other, "10-files/photo.png")).toBe(false);
  });

  it("allows staff on any key (positive)", () => {
    expect(canAccessStorageKey(admin, "10-files/photo.png")).toBe(true);
    expect(canAccessStorageKey(operator, "generated/1.png")).toBe(true);
  });

  it("allows authenticated users on public/ prefix", () => {
    expect(canAccessStorageKey(owner, "public/logo.png")).toBe(true);
    expect(canAccessStorageKey(other, "public/logo.png")).toBe(true);
  });

  it("denies non-staff on generated/ without user prefix", () => {
    expect(canAccessStorageKey(owner, "generated/1.png")).toBe(false);
  });
});

describe("isAllowedRedirectUrl", () => {
  it("allows https public hosts", () => {
    expect(
      isAllowedRedirectUrl("https://cdn.example.com/bucket/object?X-Amz=1")
    ).toBe(true);
  });

  it("rejects non-https", () => {
    expect(isAllowedRedirectUrl("http://cdn.example.com/x")).toBe(false);
    expect(isAllowedRedirectUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects localhost", () => {
    expect(isAllowedRedirectUrl("https://localhost/x")).toBe(false);
    expect(isAllowedRedirectUrl("https://127.0.0.1/x")).toBe(false);
  });

  it("rejects private IPs", () => {
    expect(isAllowedRedirectUrl("https://10.0.0.5/x")).toBe(false);
    expect(isAllowedRedirectUrl("https://192.168.1.1/x")).toBe(false);
    expect(isAllowedRedirectUrl("https://172.16.0.1/x")).toBe(false);
  });

  it("rejects cloud metadata", () => {
    expect(isAllowedRedirectUrl("https://169.254.169.254/latest/meta-data")).toBe(
      false
    );
  });

  it("rejects credentials in URL", () => {
    expect(isAllowedRedirectUrl("https://user:pass@cdn.example.com/x")).toBe(
      false
    );
  });

  it("rejects invalid URL", () => {
    expect(isAllowedRedirectUrl("not-a-url")).toBe(false);
  });
});

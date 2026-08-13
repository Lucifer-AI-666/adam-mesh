import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertConversationAccess,
  canAccessConversation,
  canGuestContinueConversation,
  isStaffRole,
} from "./conversationAccess";

const owner = { id: 10, role: "user" };
const other = { id: 99, role: "user" };
const operator = { id: 2, role: "operator" };
const admin = { id: 1, role: "admin" };
const owned = { id: 42, userId: 10 };
const guestThread = { id: 7, userId: null };

describe("conversationAccess — canAccessConversation", () => {
  it("allows the owner", () => {
    expect(canAccessConversation(owner, owned)).toBe(true);
  });

  it("denies another user (negative)", () => {
    expect(canAccessConversation(other, owned)).toBe(false);
  });

  it("allows admin on any conversation (positive staff)", () => {
    expect(canAccessConversation(admin, owned)).toBe(true);
    expect(canAccessConversation(admin, guestThread)).toBe(true);
  });

  it("allows operator on any conversation (positive staff)", () => {
    expect(canAccessConversation(operator, owned)).toBe(true);
  });

  it("denies normal user on guest (unowned) threads", () => {
    expect(canAccessConversation(owner, guestThread)).toBe(false);
  });
});

describe("conversationAccess — guest continue", () => {
  it("allows guest only on unowned threads", () => {
    expect(canGuestContinueConversation(guestThread)).toBe(true);
    expect(canGuestContinueConversation(owned)).toBe(false);
  });
});

describe("conversationAccess — assertConversationAccess", () => {
  it("throws NOT_FOUND when conversation is missing (negative)", () => {
    try {
      assertConversationAccess(owner, undefined);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("throws FORBIDDEN when user is not the owner (negative)", () => {
    try {
      assertConversationAccess(other, owned);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe("FORBIDDEN");
    }
  });

  it("does not throw for owner (positive)", () => {
    expect(() => assertConversationAccess(owner, owned)).not.toThrow();
  });

  it("does not throw for admin (positive)", () => {
    expect(() => assertConversationAccess(admin, owned)).not.toThrow();
  });

  it("does not throw for operator (positive)", () => {
    expect(() => assertConversationAccess(operator, owned)).not.toThrow();
  });

  it("throws FORBIDDEN for normal user on guest thread (negative)", () => {
    try {
      assertConversationAccess(owner, guestThread);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe("FORBIDDEN");
    }
  });
});

describe("conversationAccess — isStaffRole", () => {
  it("recognizes admin and operator only", () => {
    expect(isStaffRole("admin")).toBe(true);
    expect(isStaffRole("operator")).toBe(true);
    expect(isStaffRole("user")).toBe(false);
  });
});

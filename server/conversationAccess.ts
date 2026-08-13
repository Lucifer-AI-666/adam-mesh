import { TRPCError } from "@trpc/server";

/**
 * Minimal actor shape for conversation authorization.
 * Role must come from server-side session data, never from client input.
 */
export type ConversationActor = {
  id: number;
  role: string;
};

export type ConversationResource = {
  id?: number;
  userId: number | null;
};

const STAFF_ROLES = new Set(["admin", "operator"]);

/** Staff (admin/operator) may access any conversation for support workflows. */
export function isStaffRole(role: string): boolean {
  return STAFF_ROLES.has(role);
}

/**
 * Returns true if the actor may read or write this conversation.
 * - admin / operator: always
 * - owner: conversation.userId === actor.id
 * - guest threads (userId null): never via authenticated non-staff
 *   (anonymous continue is handled separately in chat.send)
 */
export function canAccessConversation(
  actor: ConversationActor,
  conversation: ConversationResource
): boolean {
  if (isStaffRole(actor.role)) return true;
  if (conversation.userId == null) return false;
  return conversation.userId === actor.id;
}

/** Anonymous client may only continue conversations that were created without an owner. */
export function canGuestContinueConversation(
  conversation: ConversationResource
): boolean {
  return conversation.userId == null;
}

/**
 * Throws NOT_FOUND if missing, FORBIDDEN if the actor lacks rights.
 * Does not reveal whether a forbidden conversation exists vs missing
 * for non-staff? We use FORBIDDEN when found-but-denied so negative
 * tests can assert authorization failure clearly; missing → NOT_FOUND.
 */
export function assertConversationAccess(
  actor: ConversationActor,
  conversation: ConversationResource | undefined | null
): asserts conversation is ConversationResource {
  if (!conversation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Conversation not found",
    });
  }
  if (!canAccessConversation(actor, conversation)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this conversation",
    });
  }
}

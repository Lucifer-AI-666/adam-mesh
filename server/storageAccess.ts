/**
 * Storage authorization and path safety (pure, no I/O).
 *
 * Contract:
 * - Keys are relative object paths only (no schemes, no traversal).
 * - Access requires an authenticated actor (enforced by the proxy).
 * - Staff (admin|operator) may read any valid key.
 * - Owners may read keys namespaced under their user id.
 * - `public/` is readable by any authenticated user (intentional shared assets).
 * - `generated/` without user namespace is staff-only (internal artifacts).
 */

const STAFF_ROLES = new Set(["admin", "operator"]);

/** Max key length (path after /manus-storage/). */
export const MAX_STORAGE_KEY_LENGTH = 512;

/**
 * Allowed key characters after normalization.
 * Letters, digits, slash, dash, underscore, dot.
 */
const SAFE_KEY_RE = /^[A-Za-z0-9/_.-]+$/;

export type StorageActor = {
  id: number;
  role: string;
};

/**
 * Normalize and validate a storage key from the client path.
 * Returns the cleaned key, or null if the key is unsafe.
 */
export function normalizeAndValidateStorageKey(
  raw: string | undefined | null
): string | null {
  if (raw == null) return null;

  // Decode once; reject if decoding fails or embeds null bytes
  let key: string;
  try {
    key = decodeURIComponent(String(raw));
  } catch {
    return null;
  }

  if (!key || key.length > MAX_STORAGE_KEY_LENGTH) return null;
  if (key.includes("\0")) return null;

  // Reject schemes and protocol-relative paths
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(key)) return null;
  if (key.startsWith("//")) return null;

  // Unify separators, strip leading slashes
  key = key.replace(/\\/g, "/").replace(/^\/+/, "");

  // Empty after strip
  if (!key) return null;

  // Path segments: no empties (//), no ., no ..
  const segments = key.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return null;
  }

  if (!SAFE_KEY_RE.test(key)) return null;

  return key;
}

export function isStaffRole(role: string): boolean {
  return STAFF_ROLES.has(role);
}

/**
 * Whether this actor may read the given validated key.
 * Call only after normalizeAndValidateStorageKey succeeded.
 */
export function canAccessStorageKey(
  actor: StorageActor,
  key: string
): boolean {
  if (isStaffRole(actor.role)) return true;

  // Explicit public namespace for authenticated users
  if (key.startsWith("public/")) return true;

  // Owner namespaces used by the app / docs
  const id = String(actor.id);
  if (
    key.startsWith(`${id}/`) ||
    key.startsWith(`${id}-`) ||
    key.startsWith(`${id}_`)
  ) {
    return true;
  }

  // Internal/generated objects without user prefix: staff only
  return false;
}

/**
 * Validate a forge-returned redirect URL before 307.
 * Blocks SSRF-style redirects to localhost, private nets, metadata, non-https.
 */
export function isAllowedRedirectUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return false;
  }

  // Link-local / cloud metadata
  if (host === "169.254.169.254" || host === "metadata.google.internal") {
    return false;
  }

  if (isPrivateOrReservedHostname(host)) return false;

  return true;
}

function isPrivateOrReservedHostname(host: string): boolean {
  // IPv4
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1, 5).map(Number);
    if (parts.some(p => p > 255)) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  // IPv6 bare forms (bracketless hostname from URL.hostname)
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // ULA
    if (host.startsWith("fe80")) return true; // link-local
    return false;
  }

  return false;
}

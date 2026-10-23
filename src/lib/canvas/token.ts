/**
 * Sync tokens: the web app mints one after checking access, and
 * `canvas-sync` verifies it when a websocket asks for a document. The
 * service is on another origin and never reads sessions, so this token is
 * all it knows about who is connecting.
 *
 * `base64url(JSON payload).base64url(HMAC-SHA256(payload))` on WebCrypto,
 * with no `Buffer`, so it runs in Bun, Node and the browser alike. Shared
 * with services, so no `@/` imports.
 */
import { SYNC_LIMITS } from "./limits";

export type SyncAccess = "read" | "write";

export interface CanvasTokenClaims {
  /** The full document name, `canvas:<id>` (or `note:<id>`). */
  c: string;
  /** The user's id. */
  u: string;
  a: SyncAccess;
  /** Expiry, epoch milliseconds. */
  e: number;
  v: 1;
  /** The name and avatar peers see; the service pins awareness to them. */
  n?: string;
  p?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Null for anything that isn't base64url. */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    // One secret per process in practice; the cap only guards against misuse.
    if (keys.size > 8) keys.clear();
    keys.set(secret, key);
    // A failed import is retried next time rather than cached.
    key.catch(() => keys.delete(secret));
  }
  return key;
}

export async function signCanvasToken(
  claims: { c: string; u: string; a: SyncAccess; n?: string; p?: string | null },
  secret: string,
  now: number = Date.now(),
  ttlMs: number = SYNC_LIMITS.tokenTtlMs,
): Promise<string> {
  const full: CanvasTokenClaims = { c: claims.c, u: claims.u, a: claims.a, e: now + ttlMs, v: 1 };
  if (claims.n !== undefined) full.n = claims.n;
  if (claims.p) full.p = claims.p;
  const payload = toBase64Url(encoder.encode(JSON.stringify(full)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

function isClaims(value: unknown): value is CanvasTokenClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.c === "string" &&
    claims.c.length > 0 &&
    typeof claims.u === "string" &&
    claims.u.length > 0 &&
    (claims.a === "read" || claims.a === "write") &&
    typeof claims.e === "number" &&
    Number.isFinite(claims.e) &&
    claims.v === 1 &&
    (claims.n === undefined || typeof claims.n === "string") &&
    (claims.p === undefined || typeof claims.p === "string")
  );
}

/**
 * The claims, or null for anything forged, tampered, expired, from another
 * version or simply not a token. Never throws.
 */
export async function verifyCanvasToken(
  token: unknown,
  secret: string,
  now: number = Date.now(),
): Promise<CanvasTokenClaims | null> {
  try {
    if (typeof token !== "string" || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, signaturePart] = parts as [string, string];
    if (!payload || !signaturePart) return null;
    const signature = fromBase64Url(signaturePart);
    if (!signature) return null;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      signature,
      encoder.encode(payload),
    );
    if (!valid) return null;
    const bytes = fromBase64Url(payload);
    if (!bytes) return null;
    const claims: unknown = JSON.parse(decoder.decode(bytes));
    if (!isClaims(claims)) return null;
    return claims.e > now ? claims : null;
  } catch {
    return null;
  }
}

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
import { documentProject, isSyncKind, type SyncKind } from "./sync-channels";

export type SyncAccess = "read" | "write";

/**
 * The kind of document a token opens: a sync kind, or `session` for a
 * player's token, which only game sessions admit.
 */
export type SyncTokenKind = SyncKind | "session";

/** A token's scope beyond its own document: `project` admits every document of its project. */
export type SyncTokenScope = "project";

export interface CanvasTokenClaims {
  /** The full document name: `canvas:<id>`, `scene:<id>`, `project:<id>` or `asset:<id>`. */
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
  /** The kind; absent on canvas tokens, which predate it. */
  k?: SyncTokenKind;
  /**
   * Scene tokens: the scene format version of the engine the client runs.
   * The service connects a client on another version read-only.
   */
  f?: number;
  /** With `k: "project"`, the token admits every document of `c`'s project, not just `c`. */
  s?: SyncTokenScope;
  /** The client's collab layout version; required on `project` and `asset` tokens. */
  l?: number;
  /** The agent a project-scoped agent token was minted for, and the user it acts for. */
  g?: string;
  o?: string;
  /** A player's token: opens only `session:` docs; every other kind refuses it. */
  r?: "player";
}

export function tokenKind(claims: Pick<CanvasTokenClaims, "k">): SyncTokenKind {
  return claims.k ?? "canvas";
}

/**
 * Whether a token opens `documentName`: the document it names, or, for a
 * project-scoped token, any document of that project.
 */
export function tokenAdmits(
  claims: Pick<CanvasTokenClaims, "c" | "s">,
  documentName: string,
): boolean {
  if (claims.c === documentName) return true;
  if (claims.s !== "project") return false;
  const project = documentProject(claims.c);
  return project !== null && documentProject(documentName) === project;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Null for anything that isn't base64url. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
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

/** An HMAC-SHA256 key for `secret`, imported once per process. */
export function hmacKey(secret: string): Promise<CryptoKey> {
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
  claims: {
    c: string;
    u: string;
    a: SyncAccess;
    n?: string;
    p?: string | null;
    k?: SyncTokenKind;
    f?: number;
    s?: SyncTokenScope;
    l?: number;
    g?: string;
    o?: string;
    r?: "player";
  },
  secret: string,
  now: number = Date.now(),
  ttlMs: number = SYNC_LIMITS.tokenTtlMs,
): Promise<string> {
  const full: CanvasTokenClaims = { c: claims.c, u: claims.u, a: claims.a, e: now + ttlMs, v: 1 };
  if (claims.n !== undefined) full.n = claims.n;
  if (claims.p) full.p = claims.p;
  if (claims.k && claims.k !== "canvas") full.k = claims.k;
  if (claims.f !== undefined) full.f = claims.f;
  if (claims.s !== undefined) full.s = claims.s;
  if (claims.l !== undefined) full.l = claims.l;
  if (claims.g !== undefined) full.g = claims.g;
  if (claims.o !== undefined) full.o = claims.o;
  if (claims.r !== undefined) full.r = claims.r;
  const payload = toBase64Url(encoder.encode(JSON.stringify(full)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

const isVersion = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isName = (value: unknown) => typeof value === "string" && value.length > 0;

function isClaims(value: unknown): value is CanvasTokenClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Record<string, unknown>;
  const kind = claims.k ?? "canvas";
  const agent = claims.g !== undefined || claims.o !== undefined;
  const player = claims.r === "player";
  return (
    isName(claims.c) &&
    isName(claims.u) &&
    (claims.a === "read" || claims.a === "write") &&
    typeof claims.e === "number" &&
    Number.isFinite(claims.e) &&
    claims.v === 1 &&
    (claims.n === undefined || typeof claims.n === "string") &&
    (claims.p === undefined || typeof claims.p === "string") &&
    (claims.r === undefined || player) &&
    // `session` is a player's kind only; the service decides which kinds admit players.
    (claims.k === undefined || isSyncKind(claims.k) || (claims.k === "session" && player)) &&
    (claims.f === undefined || isVersion(claims.f)) &&
    (claims.s === undefined || (claims.s === "project" && kind === "project")) &&
    (claims.l === undefined ? kind !== "project" && kind !== "asset" : isVersion(claims.l)) &&
    // Agent tokens name both the agent and the user it acts for, and are project-scoped.
    (!agent || (isName(claims.g) && isName(claims.o) && claims.s === "project"))
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

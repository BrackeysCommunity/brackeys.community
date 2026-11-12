import { fromBase64Url, hmacKey, toBase64Url } from "@/lib/canvas/token";

import { FRAME_TOKEN_HOURS } from "./limits";

/** What a private release's frame token grants: one release, to one viewer, until it expires. */
export type FrameTokenClaims = {
  /** The release id. */
  r: string;
  /** The viewer's user id; a private frame is never anonymous. */
  u: string;
  /** Expiry, epoch milliseconds. */
  e: number;
};

const FRAME_TOKEN_MS = FRAME_TOKEN_HOURS * 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 1024;
const RELEASE_ID = /^[0-9a-f]{64}$/;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const isViewer = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value !== "anon";

function frameSecret(): string | null {
  const secret = typeof process !== "undefined" ? process.env.ENGINE_FRAME_SECRET : undefined;
  return secret && secret.length >= 16 ? secret : null;
}

/**
 * A token for `/frames-private/<release>/<token>/…`: `base64url(JSON{ r, u, e }).base64url(HMAC)`
 * over `ENGINE_FRAME_SECRET`, valid `FRAME_TOKEN_HOURS`. Null without the secret, so private
 * releases refuse rather than open.
 */
export async function mintFrameToken(input: {
  releaseId: string;
  userId: string;
  now?: Date;
}): Promise<string | null> {
  if (!RELEASE_ID.test(input.releaseId)) throw new Error("A frame token needs a release id.");
  if (!isViewer(input.userId)) throw new Error("A frame token needs a signed-in viewer.");
  const secret = frameSecret();
  if (!secret) return null;
  const now = (input.now ?? new Date()).getTime();
  const claims: FrameTokenClaims = { r: input.releaseId, u: input.userId, e: now + FRAME_TOKEN_MS };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

function isClaims(value: unknown): value is FrameTokenClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.r === "string" &&
    RELEASE_ID.test(claims.r) &&
    isViewer(claims.u) &&
    typeof claims.e === "number" &&
    Number.isFinite(claims.e)
  );
}

/**
 * The claims of a token that verifies for `releaseId` and hasn't expired, else null: forged,
 * tampered, expired, for another release, or no secret configured. The signature check is
 * WebCrypto's constant-time verify, made before the body is read. Never throws.
 */
export async function verifyFrameToken(
  token: unknown,
  releaseId: string,
  now: Date = new Date(),
): Promise<FrameTokenClaims | null> {
  try {
    const secret = frameSecret();
    if (!secret || typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
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
    if (!isClaims(claims) || claims.r !== releaseId) return null;
    return claims.e > now.getTime() ? { r: claims.r, u: claims.u, e: claims.e } : null;
  } catch {
    return null;
  }
}

// Copied into the discord-bot image: relative imports only, never `@/`.

/**
 * Signs what the Discord bot relays to the web app. Both already hold the
 * bot token, so it doubles as the HMAC key and no second secret has to be
 * kept in step across services. The token itself never goes over the wire.
 *
 * Header: `<unix ms>.<hex HMAC-SHA256 of "<unix ms>.<body>">`. A replay inside
 * the skew window only repeats an idempotent resync.
 */

export const RELAY_SIGNATURE_HEADER = "x-relay-signature";

const MAX_SKEW_MS = 5 * 60_000;
const encoder = new TextEncoder();

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signRelay(secret: string, body: string, now = Date.now()): Promise<string> {
  const timestamp = String(now);
  const key = await hmacKey(secret, "sign");
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return `${timestamp}.${Buffer.from(mac).toString("hex")}`;
}

export async function verifyRelay(
  secret: string,
  body: string,
  header: string | null,
  now = Date.now(),
): Promise<boolean> {
  const match = header?.match(/^(\d{1,16})\.([0-9a-f]{64})$/);
  if (!match) return false;
  const [, timestamp, hex] = match;
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_MS) return false;
  const key = await hmacKey(secret, "verify");
  // `verify` compares in constant time; a string `===` on the hex would not.
  return crypto.subtle.verify(
    "HMAC",
    key,
    Buffer.from(hex, "hex"),
    encoder.encode(`${timestamp}.${body}`),
  );
}

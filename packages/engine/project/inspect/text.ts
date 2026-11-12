/** `bytes` as UTF-8 text without a leading byte-order mark, or null when they aren't valid UTF-8. */
export function utf8Text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * `bytes` as UTF-8 JSON. The failure reason is the engine's own sentence,
 * never the runtime's parser message, so it reads the same under every
 * JavaScript engine.
 */
export function utf8Json(
  bytes: Uint8Array,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  const text = utf8Text(bytes);
  if (text === null) return { ok: false, reason: "it isn't UTF-8 text" };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "it isn't valid JSON" };
  }
}

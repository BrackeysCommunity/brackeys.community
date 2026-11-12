import { siteOrigin } from "@/env";

/** The sandbox the play page puts on its iframe; the CSP repeats it so a frame URL opened directly is just as sandboxed. */
export const FRAME_SANDBOX =
  "allow-scripts allow-pointer-lock allow-popups allow-popups-to-escape-sandbox";

/** An origin as CSP wants it (`scheme://host[:port]`), or null for anything else. */
function originOf(value: string, schemes: readonly string[]): string | null {
  try {
    const url = new URL(value);
    if (!schemes.includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

/**
 * The frame's Content-Security-Policy for one release directory. Every source is the release's
 * own path-scoped `base` (`<playOrigin>/frames/<releaseId>/`, or the private prefix with its
 * token) rather than `'self'`, whose meaning in an opaque-origin sandbox can't be relied on.
 * Scripts get no `'unsafe-inline'`: the exported HTML has no inline script. Connect origins
 * that aren't plain `https:`/`wss:` origins are dropped, so a stored value can't add a directive.
 */
export function frameCsp(opts: {
  base: string;
  siteOrigin: string;
  connect: readonly string[];
  syncOrigin: string | null;
}): string {
  const base = opts.base;
  if (!/^https?:\/\/[^\s;,'"]+\/$/.test(base) || !originOf(base, ["http:", "https:"])) {
    throw new Error(`Not a frame directory: ${base}`);
  }
  const ancestor = originOf(opts.siteOrigin, ["http:", "https:"]);
  if (!ancestor) throw new Error(`Not a site origin: ${opts.siteOrigin}`);
  const connect = [
    ...opts.connect.map((origin) => originOf(origin, ["https:", "wss:"])),
    opts.syncOrigin === null ? null : originOf(opts.syncOrigin, ["https:", "wss:", "http:", "ws:"]),
  ].filter((origin): origin is string => origin !== null);
  return [
    `sandbox ${FRAME_SANDBOX}`,
    "default-src 'none'",
    `script-src ${base} 'wasm-unsafe-eval'`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} blob: data:`,
    `media-src ${base} blob:`,
    `font-src ${base} data:`,
    ["connect-src", base, "blob:", "data:", ...new Set(connect)].join(" "),
    "worker-src blob:",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ancestor}`,
  ].join("; ");
}

/** Where frames are served from: `ENGINE_PLAY_ORIGIN`, else the site's own origin. No trailing slash. */
export function playOrigin(): string {
  const configured =
    typeof process !== "undefined" ? process.env.ENGINE_PLAY_ORIGIN?.trim() : undefined;
  return (configured || siteOrigin()).replace(/\/+$/, "");
}

/**
 * A release's frame directory, the `base` its CSP names and its files resolve under:
 * `<playOrigin>/frames/<releaseId>/`, or `/frames-private/<releaseId>/<token>/` for a private
 * or team release.
 */
export function frameBase(
  releaseId: string,
  token?: string,
  origin: string = playOrigin(),
): string {
  return token === undefined
    ? `${origin}/frames/${releaseId}/`
    : `${origin}/frames-private/${releaseId}/${token}/`;
}

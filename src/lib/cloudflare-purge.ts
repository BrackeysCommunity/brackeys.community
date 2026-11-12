import {
  CREDITS_FILE,
  INDEX_HTML_FILE,
  RELEASE_FILE,
  SERVICE_WORKER_FILE,
  WEB_MANIFEST_FILE,
} from "@jams/engine/project";

import { frameBase, playOrigin } from "@/lib/engine/frame-csp";

/** What a purge did: sent, or why not (unconfigured, or the API refused). */
export type PurgeResult = { purged: true; urls: number } | { purged: false; reason: string };

export type PurgeDeps = {
  /** Default `CLOUDFLARE_ZONE_ID`. */
  zoneId?: string | null;
  /** Default `CLOUDFLARE_PURGE_TOKEN`. */
  token?: string | null;
  fetch?: typeof fetch;
  log?: (message: string, context?: Record<string, unknown>) => void;
  /** Where frames are served from; default `playOrigin()`. */
  origin?: string;
};

/**
 * The files a release can't boot without. Every other file of a build is
 * named by its hash and inert outside the frame, so a takedown purges these.
 */
export const SHELL_FILES = [
  INDEX_HTML_FILE,
  RELEASE_FILE,
  CREDITS_FILE,
  SERVICE_WORKER_FILE,
  WEB_MANIFEST_FILE,
] as const;

/** Cloudflare takes at most this many URLs in one purge on every plan below Enterprise. */
const URLS_PER_REQUEST = 30;

export const NOT_CONFIGURED =
  "Edge purge isn't configured (CLOUDFLARE_ZONE_ID, CLOUDFLARE_PURGE_TOKEN): edge copies stay until the CDN evicts them.";

/** A release's shell URLs on the public frame prefix; private releases are never cached at the edge. */
export function shellUrls(releaseId: string, origin: string = playOrigin()): string[] {
  const base = frameBase(releaseId, undefined, origin);
  return SHELL_FILES.map((file) => `${base}${file}`);
}

const env = (name: string) =>
  typeof process !== "undefined" ? process.env[name]?.trim() || null : null;

/**
 * Purges `urls` from Cloudflare's cache when `CLOUDFLARE_ZONE_ID` and
 * `CLOUDFLARE_PURGE_TOKEN` are set. Best effort: a failure is logged and
 * returned, never thrown, since the origin already refuses what was taken down.
 */
export async function purgeUrls(
  urls: readonly string[],
  deps: PurgeDeps = {},
): Promise<PurgeResult> {
  const warn = deps.log ?? ((message, context) => console.warn(message, context ?? {}));
  const info = deps.log ?? ((message, context) => console.info(message, context ?? {}));
  const zoneId = deps.zoneId === undefined ? env("CLOUDFLARE_ZONE_ID") : deps.zoneId;
  const token = deps.token === undefined ? env("CLOUDFLARE_PURGE_TOKEN") : deps.token;
  if (!zoneId || !token) {
    warn(`[cloudflare-purge] ${NOT_CONFIGURED}`, { urls: urls.length });
    return { purged: false, reason: NOT_CONFIGURED };
  }
  if (urls.length === 0) return { purged: true, urls: 0 };

  const send = deps.fetch ?? fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`;
  for (let i = 0; i < urls.length; i += URLS_PER_REQUEST) {
    const files = urls.slice(i, i + URLS_PER_REQUEST);
    try {
      const response = await send(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const body = (await response.json().catch(() => null)) as {
        success?: boolean;
        errors?: { message?: string }[];
      } | null;
      if (!response.ok || body?.success !== true) {
        const reason =
          body?.errors?.map((e) => e.message).find(Boolean) ?? `HTTP ${response.status}`;
        warn("[cloudflare-purge] purge refused", { status: response.status, reason, files });
        return { purged: false, reason: `Cloudflare refused the purge: ${reason}` };
      }
    } catch (err) {
      warn("[cloudflare-purge] purge failed", { err, files });
      return { purged: false, reason: "Cloudflare couldn't be reached." };
    }
  }
  info("[cloudflare-purge] purged", { urls: urls.length });
  return { purged: true, urls: urls.length };
}

/** Purges one release's five shell files from the edge. */
export function purgeShell(releaseId: string, deps: PurgeDeps = {}): Promise<PurgeResult> {
  return purgeUrls(shellUrls(releaseId, deps.origin), deps);
}

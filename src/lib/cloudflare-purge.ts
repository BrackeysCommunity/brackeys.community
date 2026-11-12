// Import-free, so canvas-sync's collector and media-scan's quarantine copy it as it is.

/** What a purge did: sent, or why not (unconfigured, or the API refused). */
export type PurgeResult = { purged: true; urls: number } | { purged: false; reason: string };

export type PurgeDeps = {
  /** Default `CLOUDFLARE_ZONE_ID`. */
  zoneId?: string | null;
  /** Default `CLOUDFLARE_PURGE_TOKEN`. */
  token?: string | null;
  fetch?: typeof fetch;
  log?: (message: string, context?: Record<string, unknown>) => void;
  /** Where frames are served from; default `configuredPlayOrigin()`. */
  origin?: string | null;
};

/**
 * The files a release can't boot without: the engine's `INDEX_HTML_FILE`,
 * `RELEASE_FILE`, `CREDITS_FILE`, `SERVICE_WORKER_FILE` and
 * `WEB_MANIFEST_FILE`. Every other file of a build is named by its hash and
 * inert outside the frame, so a takedown purges these.
 */
export const SHELL_FILES = [
  "index.html",
  "release.json",
  "credits.html",
  "sw.js",
  "app.webmanifest",
] as const;

/** Cloudflare takes at most this many URLs in one purge on every plan below Enterprise. */
const URLS_PER_REQUEST = 30;

export const NOT_CONFIGURED =
  "Edge purge isn't configured (CLOUDFLARE_ZONE_ID, CLOUDFLARE_PURGE_TOKEN): edge copies stay until the CDN evicts them.";

export const NO_ORIGIN =
  "Edge purge has no frame origin (ENGINE_PLAY_ORIGIN, VITE_SITE_ORIGIN or APP_URL): edge copies stay until the CDN evicts them.";

const env = (name: string) =>
  typeof process !== "undefined" ? process.env[name]?.trim() || null : null;

/**
 * The origin public frames are served from, read the way `playOrigin()`
 * reads it (`ENGINE_PLAY_ORIGIN`, else the site's origin) but from the
 * process environment alone, so the services see the same value. Null
 * when none is set: there is nothing at the edge to purge.
 */
export function configuredPlayOrigin(): string | null {
  const origin = env("ENGINE_PLAY_ORIGIN") ?? env("VITE_SITE_ORIGIN") ?? env("APP_URL");
  return origin ? origin.replace(/\/+$/, "") : null;
}

/** A release's shell URLs on the public frame prefix (`frameBase` without a token); private releases are never cached at the edge. */
export function shellUrls(releaseId: string, origin: string): string[] {
  return SHELL_FILES.map((file) => `${origin}/frames/${releaseId}/${file}`);
}

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

/** A release file's URL on the public frame prefix, each path segment encoded as the browser asks for it. */
export function releaseFileUrl(releaseId: string, path: string, origin: string): string {
  return `${origin}/frames/${releaseId}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Purges one release's five shell files from the edge. */
export async function purgeShell(releaseId: string, deps: PurgeDeps = {}): Promise<PurgeResult> {
  return purgeReleaseFiles(releaseId, [], deps);
}

/**
 * Purges one release's shell and the release paths in `files` from the
 * edge: a flagged image is viewable on its own URL, shell or not.
 */
export async function purgeReleaseFiles(
  releaseId: string,
  files: readonly string[],
  deps: PurgeDeps = {},
): Promise<PurgeResult> {
  const origin = deps.origin === undefined ? configuredPlayOrigin() : deps.origin;
  if (!origin) {
    (deps.log ?? ((message, context) => console.warn(message, context ?? {})))(
      `[cloudflare-purge] ${NO_ORIGIN}`,
      { releaseId },
    );
    return { purged: false, reason: NO_ORIGIN };
  }
  const urls = new Set(shellUrls(releaseId, origin));
  for (const path of files) urls.add(releaseFileUrl(releaseId, path, origin));
  return purgeUrls([...urls], deps);
}

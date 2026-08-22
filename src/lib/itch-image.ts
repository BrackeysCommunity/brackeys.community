/**
 * Cloudflare image transformation URL builders.
 *
 * Two source kinds are eligible: jam banners and game covers hotlinked from
 * `img.itch.zone` (often `/original/` masters rendered at tile size), and
 * our own uploads served at `/images/<key>` (src/routes/images.$.ts).
 * Rewriting either to `/cdn-cgi/image/<options>/<source>` lets our
 * Cloudflare zone re-encode to AVIF/WebP, resize to display size, and cache
 * the result on our own edge.
 *
 * Source-gated on purpose: `profileProjects.imageUrl` and friends are
 * polymorphic (itch cover URL, `/images/` upload, a `blob:` editor preview,
 * Discord/GitHub avatar), so the rewrite keys on the source rather than
 * which field the URL came from. Anything else passes through untouched,
 * which makes the helpers safe to apply blindly at mixed-origin call sites.
 *
 * `onerror=redirect` is always included so a failed transform (feature off,
 * origin blocked, source 404) falls back to the original image rather than a
 * broken tile.
 *
 * Adapted from parkfi.sh `src/lib/image.ts`; docs:
 * https://developers.cloudflare.com/images/transform-images/transform-via-url/
 */
import { env } from "@/env";
import { STORED_IMAGE_ROUTE_PREFIX } from "@/lib/stored-image-urls";

export interface ItchImageOpts {
  /** Target width in CSS px. Omit to re-encode at the source's own size. */
  width?: number;
  /** Target height in CSS px. Omit to keep the source aspect. */
  height?: number;
  /** 1–100. Defaults to {@link DEFAULT_ITCH_IMAGE_QUALITY}. */
  quality?: number;
  /**
   * How the image fits the requested box. Defaults to `scale-down`, which
   * never enlarges a smaller master — `cover` does (parkfi measured a 500px
   * master ballooning into a 457 kB upscale), which is why it isn't the
   * default here either.
   */
  fit?: "cover" | "contain" | "scale-down" | "crop" | "pad";
  /** `false` returns the first frame of an animated source (see lib/still-image). */
  anim?: boolean;
}

/** Tuned for banners/covers rendered as tiles; heroes pass a higher value. */
export const DEFAULT_ITCH_IMAGE_QUALITY = 60;

/**
 * Width ladder for `srcSet` on genuinely wide surfaces. Capped at 1280 —
 * itch jam banners rarely carry more real detail, and every rung is a
 * billable unique transformation.
 */
export const DEFAULT_ITCH_IMAGE_WIDTHS = [480, 960, 1280] as const;

/**
 * Options for blurred decorative backdrops (`blur-xl` layers behind banner
 * art): detail is invisible, so request almost nothing.
 */
export const BACKDROP_TRANSFORM: ItchImageOpts = { width: 64, quality: 40 };

/**
 * Shared transform for the calendar board's `BannerMedia` and the crisp
 * layer of `JamDetailModal` — one width for both so a jam already fetched
 * on the board isn't re-fetched at a second size in the modal.
 */
export const BOARD_BANNER_TRANSFORM: ItchImageOpts = { width: 640 };

const ITCH_IMAGE_ORIGIN = "https://img.itch.zone/";

export const cfImagesEnabled = () => env.VITE_CF_IMAGES !== undefined;

/**
 * True only for itch-hosted https URLs and our own `/images/` uploads that
 * haven't already been rewritten. Excludes `blob:`/`data:` URIs,
 * Discord/GitHub avatars, other relative paths — everything that must never
 * hit the transformer.
 */
export function isTransformable(url: string): boolean {
  if (url.includes("/cdn-cgi/image/")) return false;
  return url.startsWith(ITCH_IMAGE_ORIGIN) || url.startsWith(STORED_IMAGE_ROUTE_PREFIX);
}

function optionString(opts: ItchImageOpts): string {
  return [
    opts.width ? `width=${opts.width}` : null,
    opts.height ? `height=${opts.height}` : null,
    `quality=${opts.quality ?? DEFAULT_ITCH_IMAGE_QUALITY}`,
    "format=auto",
    opts.width || opts.height ? `fit=${opts.fit ?? "scale-down"}` : null,
    opts.anim === false ? "anim=false" : null,
    "onerror=redirect",
  ]
    .filter(Boolean)
    .join(",");
}

/**
 * Rewrite an itch image URL to its Cloudflare-transformed form. Returns the
 * input unchanged when the gate is off or the URL isn't itch-hosted, so
 * nullable and polymorphic sources can be passed straight through.
 */
export function itchImageUrl<T extends string | null | undefined>(
  url: T,
  opts: ItchImageOpts = {},
): T {
  if (!url || !cfImagesEnabled() || !isTransformable(url)) return url;
  // Same-zone sources are referenced by their path without the leading
  // slash: /cdn-cgi/image/<options>/images/<key>.
  const source = url.startsWith("/") ? url.slice(1) : url;
  return `/cdn-cgi/image/${optionString(opts)}/${source}` as T;
}

/**
 * The `original` master behind an itch derivative URL. Only for a source
 * about to go through {@link itchImageUrl} — the master can be megabytes.
 */
export function itchOriginalUrl<T extends string | null | undefined>(url: T): T {
  if (!url || !url.startsWith(ITCH_IMAGE_ORIGIN)) return url;
  const segments = url.slice(ITCH_IMAGE_ORIGIN.length).split("/");
  // <base64>/<derivative>/<name> — anything shorter isn't a derivative URL.
  if (segments.length < 3) return url;
  segments[1] = "original";
  return `${ITCH_IMAGE_ORIGIN}${segments.join("/")}` as T;
}

/**
 * Width-descriptor `srcSet` for a wide surface. Returns `undefined` when the
 * URL isn't transformable (or the gate is off) so callers fall back to the
 * bare `src`.
 */
export function itchImageSrcSet(
  url: string | null | undefined,
  widths: readonly number[] = DEFAULT_ITCH_IMAGE_WIDTHS,
  opts: Omit<ItchImageOpts, "width" | "height"> = {},
): string | undefined {
  if (!url || !cfImagesEnabled() || !isTransformable(url)) return undefined;
  return widths.map((w) => `${itchImageUrl(url, { ...opts, width: w })} ${w}w`).join(", ");
}

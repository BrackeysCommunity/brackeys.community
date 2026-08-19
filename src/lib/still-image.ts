import { isTransformable, itchImageUrl } from "@/lib/itch-image";

const DISCORD_CDN = "https://cdn.discordapp.com/";

/** Everything before the query/hash — a `.gif` in either is not the format. */
function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** True for URLs that will animate on their own once rendered. */
export function isAnimatedImageUrl(url: string | null | undefined): boolean {
  return url != null && pathOf(url).toLowerCase().endsWith(".gif");
}

/**
 * First-frame twin of an animated image URL. Discord serves the still under the
 * same path with a `.png` extension; everything else goes through the Cloudflare
 * transformer with `anim=false`. Anything it can't freeze passes through
 * unchanged, so callers can compare the result against their input.
 */
export function stillImageUrl<T extends string | null | undefined>(url: T): T {
  if (!url || !isAnimatedImageUrl(url)) return url;
  if (url.startsWith(DISCORD_CDN)) {
    const path = pathOf(url);
    return `${path.slice(0, -4)}.png${url.slice(path.length)}` as T;
  }
  if (isTransformable(url)) return itchImageUrl(url, { anim: false });
  return url;
}

import { type ItchImageOpts, isTransformable, itchImageUrl } from "@/lib/itch-image";

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
 *
 * Pass a `width` when the render box is known — without one the frozen
 * frame is re-encoded at the master's own resolution, which is what a
 * 24px avatar decoding a full-size banner looks like.
 */
export function stillImageUrl<T extends string | null | undefined>(
  url: T,
  opts?: ItchImageOpts,
): T {
  if (!url || !isAnimatedImageUrl(url)) return url;
  if (url.startsWith(DISCORD_CDN)) {
    const path = pathOf(url);
    return `${path.slice(0, -4)}.png${url.slice(path.length)}` as T;
  }
  if (isTransformable(url)) return itchImageUrl(url, { ...opts, anim: false });
  return url;
}

/**
 * The rendered/still/animated triple behind a hover-to-play art surface.
 * `still` is what mounts; `animated` is non-null only when a distinct frozen
 * twin exists. When the source can't be frozen (transformer off, foreign
 * host) the two collapse to the same URL and the art just plays.
 */
export function hoverPlaySources(src: string, transform?: ItchImageOpts) {
  const rendered = transform ? itchImageUrl(src, transform) : src;
  if (!isAnimatedImageUrl(src)) return { rendered, still: rendered, animated: null };
  // `stillImageUrl` also freezes Discord gifs (via the `.png` twin), which
  // the transformer can't touch — so a transform no longer disables that.
  const still = stillImageUrl(src, transform);
  return { rendered, still, animated: still !== rendered ? rendered : null };
}

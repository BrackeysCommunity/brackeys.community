/**
 * A pasted link → the player or media it stands for, for markdown bodies
 * that show progress (devlogs, short posts).
 *
 * Every frame `src` is built here from an id parsed out of the link, never
 * taken from the link itself, so the set of origins a body can frame is
 * exactly the providers below. Direct media files keep their own URL, like
 * a markdown image already does.
 */

export type MediaEmbed =
  /** A `twitch` src still needs `&parent=<host>`: Twitch refuses to play
   * without the embedding page's hostname, which only the browser knows. */
  | {
      kind: "frame";
      provider: "youtube" | "vimeo" | "twitch" | "streamable";
      src: string;
      title: string;
    }
  | { kind: "video"; src: string }
  | { kind: "image"; src: string };

const VIDEO_FILE = /\.(mp4|webm|mov|m4v)$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif)$/i;
const YOUTUBE_ID = /^[\w-]{11}$/;

function parseUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** `t=1m30s`, `t=90s` or `t=90` → seconds. */
function startSeconds(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !match[0]) return null;
  const [, h = "0", m = "0", s = "0"] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

function youtube(url: URL, host: string): MediaEmbed | null {
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0] ?? null;
  } else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (first === "shorts" || first === "embed" || first === "live") id = second ?? null;
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  const start = startSeconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return {
    kind: "frame",
    provider: "youtube",
    src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`,
    title: "YouTube video",
  };
}

function vimeo(url: URL, host: string): MediaEmbed | null {
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  const match = /^\/(?:video\/)?(\d+)(?:\/([\da-f]+))?\/?$/.exec(url.pathname);
  if (!match) return null;
  const hash = match[2] ?? url.searchParams.get("h");
  return {
    kind: "frame",
    provider: "vimeo",
    src: `https://player.vimeo.com/video/${match[1]}${hash && /^[\da-f]+$/.test(hash) ? `?h=${hash}` : ""}`,
    title: "Vimeo video",
  };
}

function twitch(url: URL, host: string): MediaEmbed | null {
  const parts = url.pathname.split("/").filter(Boolean);
  let query: string | null = null;
  if (host === "clips.twitch.tv" && parts.length === 1) {
    query = `clip=${encodeURIComponent(parts[0]!)}`;
  } else if (host === "twitch.tv" || host === "m.twitch.tv") {
    if (parts.length === 3 && parts[1] === "clip") query = `clip=${encodeURIComponent(parts[2]!)}`;
    else if (parts.length === 2 && parts[0] === "videos" && /^\d+$/.test(parts[1]!)) {
      query = `video=${parts[1]}`;
    }
  }
  if (!query) return null;
  const base = query.startsWith("clip=")
    ? "https://clips.twitch.tv/embed"
    : "https://player.twitch.tv/";
  return {
    kind: "frame",
    provider: "twitch",
    src: `${base}?${query}&autoplay=false`,
    title: "Twitch video",
  };
}

function streamable(url: URL, host: string): MediaEmbed | null {
  if (host !== "streamable.com") return null;
  const match = /^\/(?:e\/)?([a-z\d]+)\/?$/i.exec(url.pathname);
  if (!match) return null;
  return {
    kind: "frame",
    provider: "streamable",
    src: `https://streamable.com/e/${match[1]}`,
    title: "Streamable video",
  };
}

export function mediaEmbedFor(href: string): MediaEmbed | null {
  const url = parseUrl(href);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  const frame =
    youtube(url, host) ?? vimeo(url, host) ?? twitch(url, host) ?? streamable(url, host);
  if (frame) return frame;

  // Media files only over https: an http one is blocked as mixed content.
  if (url.protocol !== "https:") return null;
  // Imgur's `.gifv` is a page wrapping an mp4 of the same name.
  if (host === "i.imgur.com" && url.pathname.endsWith(".gifv")) {
    return { kind: "video", src: `https://i.imgur.com${url.pathname.replace(/\.gifv$/, ".mp4")}` };
  }
  if (VIDEO_FILE.test(url.pathname)) return { kind: "video", src: url.href };
  if (IMAGE_FILE.test(url.pathname)) return { kind: "image", src: url.href };
  return null;
}

const BARE_URL_LINE = /^\s*<?(https?:\/\/\S+?)>?\s*$/;
const FENCE = /^\s*(```|~~~)/;

export type LoneMedia = { embed: MediaEmbed; href: string };

/**
 * A body cut at its first media link — one sitting alone on its line,
 * outside a code fence — for a card that shows the post in order but only
 * as far as its first clip. Text written around media usually points at it
 * ("take two:"), so cutting there keeps the caption beside its clip where
 * lifting the clips out would strand it.
 */
export function splitAtFirstMedia(markdown: string): {
  /** The prose before the first media link; the whole body if it has none. */
  before: string;
  first: LoneMedia | null;
  /** Lone media links in the body, the first included. */
  mediaCount: number;
  /** Whether prose continues past the first media link. */
  moreText: boolean;
} {
  const lines = markdown.split("\n");
  let fenced = false;
  let first: LoneMedia | null = null;
  let cut = lines.length;
  let mediaCount = 0;
  let moreText = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) fenced = !fenced;
    const href = fenced ? null : BARE_URL_LINE.exec(line)?.[1];
    const embed = href ? mediaEmbedFor(href) : null;
    if (href && embed) {
      mediaCount += 1;
      if (!first) {
        first = { embed, href };
        cut = i;
      }
    } else if (first && line.trim()) {
      moreText = true;
    }
  });
  return { before: lines.slice(0, cut).join("\n").trim(), first, mediaCount, moreText };
}

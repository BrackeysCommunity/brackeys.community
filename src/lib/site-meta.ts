import { siteOrigin, siteUrl } from "@/env";
import { deployEnvLabel } from "@/lib/deploy-env";
import {
  cfImagesEnabled,
  DISCORD_CDN_ORIGIN,
  itchImageUrl,
  itchOriginalUrl,
} from "@/lib/itch-image";
import { SITE } from "@/lib/legal-meta";

export const SITE_NAME = "Brackeys Community";

export const SITE_DESCRIPTION =
  "The Brackeys community hub: every game jam worth entering, the people making games in them, and the teams looking for someone like you.";

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Served from `public/`, so `/og/$`'s failure redirect can't loop back into itself. */
export const DEFAULT_OG_IMAGE = "/og/brackeys-card.png";

/**
 * Bump when the card design changes. Discord and Cloudflare both cache a
 * card by its URL — Discord's image proxy for far longer than our day-long
 * edge TTL — so a new design only reaches a shared link under a new URL.
 * `/og/$` reads the path for the card and ignores `v`.
 */
export const OG_CARD_VERSION = 2;

const OG_VERSION_QUERY = `?v=${OG_CARD_VERSION}`;

export const DEFAULT_OG_CARD = `/og/default.png${OG_VERSION_QUERY}`;

/**
 * `&embed` renders a card without its left spine, for Discord component
 * embeds: the container draws its own accent bar, and two stripes clash.
 */
const OG_EMBED_QUERY = "&embed";

export const DEFAULT_OG_EMBED_CARD = `${DEFAULT_OG_CARD}${OG_EMBED_QUERY}`;

/** The generated 404 card, for every "not found" head branch. */
export const NOT_FOUND_OG_CARD = `/og/notfound.png${OG_VERSION_QUERY}`;

export function ogCardPath(
  kind: OgCardKind,
  id: string | number,
  { embed = false }: { embed?: boolean } = {},
): string {
  return `/og/${kind}/${encodeURIComponent(String(id))}.png${OG_VERSION_QUERY}${embed ? OG_EMBED_QUERY : ""}`;
}

export type OgCardKind =
  | "jam"
  | "project"
  | "collab"
  | "profile"
  | "team"
  | "board"
  | "forum"
  | "category";

export interface HeadMetaTag {
  title?: string;
  name?: string;
  property?: string;
  content?: string;
}

export interface HeadLinkTag {
  rel: string;
  href: string;
  type?: string;
  sizes?: string;
  media?: string;
  title?: string;
}

export interface PageMetaInput {
  title?: string;
  description?: string;
  /** Origin-relative, in canonical casing. Never the live URL. */
  path: string;
  /** `ogCardPath(…)`. Wins over `image`. */
  card?: string | null;
  image?: string | null;
  imageAlt?: string | null;
  type?: "website" | "article" | "profile";
  /** `noindex, follow` — crawled through, not indexed. */
  noindex?: boolean;
  noindexNofollow?: boolean;
  /**
   * `false` drops the canonical link. For heads whose `path` is not the
   * page itself — a 404 branch pointing at its listing — where a canonical
   * would contradict the robots directive about the same URL.
   */
  canonical?: boolean;
  meta?: HeadMetaTag[];
  links?: HeadLinkTag[];
}

/**
 * The browser-tab title. Carries the deploy marker's prefix on every
 * non-production deploy — a tab strip with both environments open in it is
 * exactly where the badge beside the logo can't be seen. Social titles keep
 * the clean name: a staging page is `noindex` and never meant to be shared.
 */
export function pageTitle(title?: string): string {
  const name = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  const marker = deployEnvLabel();
  return marker ? `[${marker}] ${name}` : name;
}

/** Dimensions ride along only when we resized the image ourselves. */
export function socialImage(source?: string | null): {
  url: string;
  width?: number;
  height?: number;
  type?: string;
} {
  if (!source) {
    return {
      url: siteUrl(DEFAULT_OG_CARD),
      width: OG_IMAGE_WIDTH,
      height: OG_IMAGE_HEIGHT,
      type: "image/png",
    };
  }
  if (!cfImagesEnabled()) return { url: siteUrl(source) };
  // A Discord avatar is transformable everywhere else on the site, but a
  // card is 1200x630 and `cover` enlarges: a 128px avatar comes back as a
  // blurred crop. Leave it at its own size and let the platform frame it.
  if (source.startsWith(DISCORD_CDN_ORIGIN)) return { url: siteUrl(source) };
  const transformed = itchImageUrl(itchOriginalUrl(source), {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    // `cover`, not the house `scale-down`: a card is a fixed box.
    fit: "cover",
    quality: 80,
    // X does not animate GIFs in cards.
    anim: false,
  });
  // Unchanged means it wasn't ours to transform: absolute, but unmeasured.
  if (transformed === source) return { url: siteUrl(source) };
  return { url: siteUrl(transformed), width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT };
}

export function buildMeta(input: PageMetaInput): { meta: HeadMetaTag[]; links: HeadLinkTag[] } {
  const title = pageTitle(input.title);
  const description = input.description ?? SITE_DESCRIPTION;
  const canonical = siteUrl(input.path);
  const image = input.card
    ? {
        url: siteUrl(input.card),
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        type: "image/png",
      }
    : socialImage(input.image);
  const robots = input.noindexNofollow
    ? "noindex, nofollow"
    : input.noindex
      ? "noindex, follow"
      : null;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      ...(robots ? [{ name: "robots", content: robots }] : []),

      { property: "og:site_name", content: SITE_NAME },
      { property: "og:type", content: input.type ?? "website" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: canonical },
      { property: "og:title", content: input.title ?? SITE_NAME },
      { property: "og:description", content: description },
      { property: "og:image", content: image.url },
      ...(image.width
        ? [
            { property: "og:image:width", content: String(image.width) },
            { property: "og:image:height", content: String(image.height) },
          ]
        : []),
      ...(image.type ? [{ property: "og:image:type", content: image.type }] : []),
      { property: "og:image:alt", content: input.imageAlt ?? input.title ?? SITE_NAME },

      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: input.title ?? SITE_NAME },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image.url },

      ...(input.meta ?? []),
    ],
    links: [
      ...(input.canonical === false ? [] : [{ rel: "canonical", href: canonical }]),
      ...(input.links ?? []),
    ],
  };
}

/**
 * Keeps filter permutations out of the index. A facet that earns indexing
 * needs a self-referential canonical of its own, not an exception here.
 */
export function listingMeta(
  input: Omit<PageMetaInput, "noindex"> & { search?: Record<string, unknown> },
): { meta: HeadMetaTag[]; links: HeadLinkTag[] } {
  const { search, ...rest } = input;
  const filtered =
    search != null && Object.values(search).some((value) => value !== undefined && value !== false);
  return buildMeta({ ...rest, noindex: filtered });
}

/**
 * One `<script type="application/ld+json">` per node. An array in a single
 * script is valid JSON-LD too, but readers that expect one object per
 * script (Safari extensions in the wild read `@context` off the parsed
 * value and throw on an array) only break on the array form, and every
 * consumer accepts this one.
 */
export function jsonLd(data: object | object[]): {
  type: string;
  children: string;
}[] {
  const nodes = Array.isArray(data) ? data : [data];
  return nodes.map((node) => ({
    type: "application/ld+json",
    // `<` is the only character that can break out of a script element.
    children: JSON.stringify(node).replaceAll("<", "\\u003c"),
  }));
}

export function organizationNode() {
  return {
    "@type": "Organization",
    "@id": `${siteOrigin()}/#organization`,
    name: SITE_NAME,
    url: siteOrigin(),
    logo: siteUrl("/brackeys-logo.svg"),
    sameAs: [SITE.discord],
  };
}

export function breadcrumbNode(trail: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: siteUrl(step.path),
    })),
  };
}

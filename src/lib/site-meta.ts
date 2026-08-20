import { SITE } from "@/components/legal/legal-meta";
import { siteOrigin, siteUrl } from "@/env";
import { cfImagesEnabled, itchImageUrl, itchOriginalUrl } from "@/lib/itch-image";

export const SITE_NAME = "Brackeys Community";

export const SITE_DESCRIPTION =
  "The Brackeys community hub: every game jam worth entering, the people making games in them, and the teams looking for someone like you.";

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Served from `public/`, so `/og/$`'s failure redirect can't loop back into itself. */
export const DEFAULT_OG_IMAGE = "/og/brackeys-card.png";

export const DEFAULT_OG_CARD = "/og/default.png";

export function ogCardPath(kind: OgCardKind, id: string | number): string {
  return `/og/${kind}/${encodeURIComponent(String(id))}.png`;
}

export type OgCardKind = "jam" | "project" | "collab" | "profile" | "team";

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
  meta?: HeadMetaTag[];
  links?: HeadLinkTag[];
}

export function pageTitle(title?: string): string {
  return title ? `${title} · ${SITE_NAME}` : SITE_NAME;
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
    links: [{ rel: "canonical", href: canonical }, ...(input.links ?? [])],
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

export function jsonLd(data: object | object[]): {
  type: string;
  children: string;
}[] {
  const nodes = Array.isArray(data) ? data : [data];
  if (nodes.length === 0) return [];
  return [
    {
      type: "application/ld+json",
      // `<` is the only character that can break out of a script element.
      children: JSON.stringify(nodes.length === 1 ? nodes[0] : nodes).replaceAll("<", "\\u003c"),
    },
  ];
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

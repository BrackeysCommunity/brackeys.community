/**
 * What a brackeys.community link turns into when someone pastes it into
 * Discord.
 *
 * One layout per page kind, built out of `discord-embed`'s components and
 * emitted from the route's `head()` as a `discord:component-embed` script.
 * No bot, no share button, no guild setup — any member pasting the URL in
 * any server gets this instead of the Open Graph card.
 *
 * Sources are typed structurally, the way `collab-discord-feed.ts` types
 * its own: these run off whatever the route loader already holds, and a
 * layout should not force a loader to fetch a column for its sake.
 */

import { siteUrl } from "@/env";
import {
  ACCENT_CLOSED,
  ACCENT_RECRUITING,
  accentColor,
  actionRow,
  BRAND_ACCENT,
  container,
  type Container,
  linkButton,
  mdEscape,
  mdLink,
  mediaGallery,
  separator,
  subtext,
  textDisplay,
} from "@/lib/discord-embed";
import { collabRateLine, type CollabRateSource } from "@/lib/format-rate";
import { itchImageUrl, itchOriginalUrl } from "@/lib/itch-image";
import { jamSlug, jamUrl } from "@/lib/jam-links";
import { safeThemeColor } from "@/lib/jam-palette";
import { profileSlug } from "@/lib/profile-links";
import { ogCardPath } from "@/lib/site-meta";
import { teamSlug } from "@/lib/team-links";

/**
 * The page's own generated social card (`src/lib/og/`), as a gallery item.
 *
 * This is the same 1200×630 PNG the `og:image` tag points at, which is why
 * it is the safe piece of art to lean on: it is ours, it is edge-cached for
 * a day, and a render failure redirects to the committed static card rather
 * than 404ing — so Discord's ten-second budget never ends with a hole where
 * the image should be. It also already composes the title, the dates, the
 * counts and the letterboxed source art, which is what the layouts here
 * trim their text against.
 */
function cardImage(kind: Parameters<typeof ogCardPath>[0], id: string | number): string {
  return siteUrl(ogCardPath(kind, id));
}

/**
 * Art we did not compose: **uncropped**, wide, re-encoded on our own edge.
 * A width with no height keeps the source's aspect ratio (`fit: scale-down`)
 * — the same thing the detail hero does, and for the same reason. A height
 * would force `fit: cover`, which is what slices the edges off a poster.
 *
 * Going through our origin also sidesteps itch's CDN, which 403s often
 * enough that hotlinking would cost us the image — and a missing image
 * costs the whole layout.
 */
const GALLERY_WIDTH = 1280;

/**
 * A gallery takes ten, but a preview wants four: Discord lays four out as a
 * tidy 2×2 and anything past that shrinks each shot to a tile. Four image
 * URLs also leave room inside the payload's byte budget — going over it
 * drops the layout back to the Open Graph card, which is a worse trade than
 * showing one screenshot fewer.
 */
const PREVIEW_GALLERY_ITEMS = 4;

function galleryImage(url: string | null | undefined): string | null {
  if (!url) return null;
  return siteUrl(itchImageUrl(itchOriginalUrl(url), { width: GALLERY_WIDTH, quality: 80 }));
}

export interface JamPreviewSource {
  slug: string;
  title: string;
  themeColor: string | null;
}

/**
 * A jam page's preview: the linked title, the host's own blurb, our
 * generated card, and the two places to go next.
 *
 * The card is the art *and* most of the copy — it composes the title, the
 * window, the host, entries, ratings and the lifecycle status over the
 * letterboxed banner (see `jamCard` in `lib/og/data.ts`). So the text above
 * it is deliberately thin: repeating any of that would have the embed say
 * everything twice. What stays is what the card can't do — a title that is
 * actually clickable, and the blurb, which never goes on the card.
 *
 * An earlier pass put the raw banner in a section thumbnail. A thumbnail is
 * a small square, so every banner that wasn't square arrived cropped, and
 * jam banners are posters with lettering running to the edges.
 */
export function jamLinkPreview(
  jam: JamPreviewSource,
  { blurb }: { blurb?: string | null } = {},
): Container | null {
  const url = siteUrl(`/jams/${jam.slug}`);

  return container(
    [
      textDisplay(`## ${mdLink(jam.title, url)}`),
      blurb ? textDisplay(mdEscape(blurb)) : null,
      mediaGallery([{ url: cardImage("jam", jam.slug), description: jam.title }]),
      separator(),
      actionRow([
        linkButton("Open on Brackeys", url),
        linkButton("View on itch.io", jamUrl(jam.slug)),
      ]),
    ],
    { accent: accentColor(safeThemeColor(jam.themeColor)) ?? BRAND_ACCENT },
  );
}

export interface CollabPreviewSource extends CollabRateSource {
  id: number;
  title: string;
  status: string;
  responseCount: number;
  images: { url: string; alt: string | null }[];
  jam: { jamId: number; title: string; slug: string | null } | null;
  team: { id: string; name: string; slug: string | null } | null;
  author: { id: string; urlStub: string | null } | null;
}

/**
 * A collab post's preview: the linked title, the terms the card can't fit,
 * our generated card, and the same three buttons the feed mirror in
 * `collab-discord-feed.ts` offers, in the same order.
 *
 * `collabCard` already composes the title, the description, the roles, a
 * Paid/Hobby chip and who posted it over the post's first screenshot, so the
 * text here carries only what it leaves out: the actual rate, the jam this
 * recruits for, whether the post is still open, and how many people have
 * applied. The card's own art is the first uploaded image, so the gallery
 * picks up from the second — nothing is shown twice.
 *
 * `authorName` comes from the caller because display names are
 * viewer-dependent (`member-name.ts`), and a link preview has no viewer.
 */
export function collabLinkPreview(
  post: CollabPreviewSource,
  { authorName }: { authorName: string | null },
): Container | null {
  const url = siteUrl(`/collab/${post.id}`);
  const jamUrlOnSite = post.jam ? siteUrl(`/jams/${jamSlug(post.jam)}`) : null;
  const isClosed = post.status !== "recruiting";

  const terms = [
    collabRateLine(post),
    post.jam && jamUrlOnSite ? mdLink(post.jam.title, jamUrlOnSite) : null,
    isClosed ? "**No longer recruiting**" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // A team post is posted *by the team* — the same rule the feed mirror's
  // byline follows. Only a solo post names the person. The card prints the
  // name too; this one is a link to them.
  const byline = post.team
    ? `Posted by ${mdLink(post.team.name, siteUrl(`/teams/${teamSlug(post.team)}`))}`
    : post.author && authorName
      ? `Posted by ${mdLink(authorName, siteUrl(`/profile/${profileSlug(post.author)}`))}`
      : null;

  const footer = [byline, post.responseCount > 0 ? `${post.responseCount} applied` : null]
    .filter(Boolean)
    .join(" · ");

  return container(
    [
      textDisplay([`## ${mdLink(post.title, url)}`, terms].filter(Boolean).join("\n")),
      mediaGallery(
        [
          { url: cardImage("collab", post.id), description: post.title },
          ...post.images.slice(1).map((image) => ({
            url: galleryImage(image.url),
            description: image.alt,
          })),
        ]
          .filter((item) => item.url)
          .slice(0, PREVIEW_GALLERY_ITEMS),
      ),
      footer ? textDisplay(subtext(footer)) : null,
      separator(),
      actionRow([
        linkButton(isClosed ? "View the post" : "Apply on Brackeys", url),
        post.jam ? linkButton(`Jam: ${post.jam.title}`, jamUrlOnSite) : null,
        linkButton("All open posts", siteUrl("/collab")),
      ]),
    ],
    { accent: isClosed ? ACCENT_CLOSED : ACCENT_RECRUITING },
  );
}

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
  section,
  separator,
  subtext,
  textDisplay,
  thumbnail,
} from "@/lib/discord-embed";
import { formatCount } from "@/lib/format-count";
import { collabRateLine, type CollabRateSource } from "@/lib/format-rate";
import { itchImageUrl, itchOriginalUrl } from "@/lib/itch-image";
import { effectiveJamState } from "@/lib/jam-countdown";
import { hostName, jamDateRange, jamSlug, jamUrl } from "@/lib/jam-links";
import { safeThemeColor } from "@/lib/jam-palette";
import { profileSlug } from "@/lib/profile-links";
import { teamSlug } from "@/lib/team-links";

/**
 * Art for a gallery: wide, re-encoded on our own edge, and — the whole
 * point — **uncropped**. `socialImage` exists for the Open Graph card, where
 * a fixed 1200×630 box forces `fit: cover`; run a jam banner through that
 * and the poster the host designed gets its edges sliced off. A width with
 * no height keeps the source's own aspect ratio (`fit: scale-down`), which
 * is the same thing the detail hero does for the same reason.
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
  bannerUrl: string | null;
  themeColor: string | null;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  votingEndsAt: Date | string | null;
  joinedCount: number | null;
  ratingsCount: number | null;
  hosts: { name: string }[];
}

const PHASE_LABEL: Record<ReturnType<typeof effectiveJamState>, string> = {
  running: "LIVE",
  upcoming: "UPCOMING",
  voting: "VOTING",
  ended: "CLOSED",
  unknown: "DATES TBA",
};

/**
 * A jam page's preview: the title and where the jam is in its lifecycle,
 * the host's own blurb, the banner at full width, and the two places to go
 * next.
 *
 * The banner is a gallery item rather than a section thumbnail. A thumbnail
 * is a small square, so every banner that isn't square arrived cropped —
 * and jam banners are posters, wider than they are tall, with the title
 * lettering running to the edges. A single-item gallery renders the art
 * full-bleed at its own aspect ratio, which is what the card people are
 * used to seeing does.
 *
 * Dates render as absolute UTC rather than Discord's live `<t:…:R>` markup.
 * A preview is built once, when the link is first pasted, and then sits in
 * the channel forever — so until the relative form is confirmed to render
 * inside a component embed, a date that stays true beats a countdown that
 * might not.
 */
export function jamLinkPreview(
  jam: JamPreviewSource,
  { trackedEntries, blurb }: { trackedEntries: number; blurb?: string | null },
  now: Date = new Date(),
): Container | null {
  const url = siteUrl(`/jams/${jam.slug}`);
  const state = effectiveJamState(jam.startsAt, jam.endsAt, now, jam.votingEndsAt);
  const status = [`**${PHASE_LABEL[state]}**`, jamDateRange(jam.startsAt, jam.endsAt)]
    .filter(Boolean)
    .join(" · ");

  // Which participation number reads as news depends on the phase: before
  // the deadline it's how many people signed up, after it it's how much
  // rating the entries have actually drawn.
  const crowd =
    state === "upcoming" || state === "running"
      ? jam.joinedCount && jam.joinedCount > 0
        ? `${formatCount(jam.joinedCount)} joined`
        : null
      : jam.ratingsCount && jam.ratingsCount > 0
        ? `${formatCount(jam.ratingsCount)} ratings`
        : null;

  const facts = [
    jam.hosts[0] ? `Hosted by ${mdEscape(hostName(jam))}` : null,
    trackedEntries > 0 ? `${formatCount(trackedEntries)} submissions tracked here` : null,
    crowd,
  ]
    .filter(Boolean)
    .join(" · ");

  return container(
    [
      textDisplay([`## ${mdLink(jam.title, url)}`, status].filter(Boolean).join("\n")),
      blurb ? textDisplay(mdEscape(blurb)) : null,
      mediaGallery([{ url: galleryImage(jam.bannerUrl), description: jam.title }]),
      facts ? textDisplay(subtext(facts)) : null,
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
  roles: { name: string }[];
  images: { url: string; alt: string | null }[];
  jam: { jamId: number; title: string; slug: string | null } | null;
  team: { id: string; name: string; slug: string | null; avatarUrl: string | null } | null;
  project: { title: string; imageUrl: string | null } | null;
  author: { id: string; urlStub: string | null } | null;
}

/**
 * A collab post's preview. Carries the same vocabulary as the feed mirror
 * in `collab-discord-feed.ts` — looking for, terms, and the same three
 * buttons in the same order — so a post reads identically whether its
 * author shared it deliberately or someone just dropped the link.
 *
 * The avatar stays a section thumbnail: avatars are square at the source,
 * so the square crop takes nothing off them. Everything the author
 * uploaded — the project cover first, then the post's own shots — goes to
 * the gallery below the description instead, at its own aspect ratio.
 *
 * `authorName` and `authorAvatarUrl` come from the caller because both are
 * viewer-dependent (`member-name.ts`), and a link preview has no viewer.
 */
export function collabLinkPreview(
  post: CollabPreviewSource,
  {
    authorName,
    authorAvatarUrl,
    description,
  }: { authorName: string | null; authorAvatarUrl: string | null; description: string },
): Container | null {
  const url = siteUrl(`/collab/${post.id}`);
  const jamUrlOnSite = post.jam ? siteUrl(`/jams/${jamSlug(post.jam)}`) : null;
  const isClosed = post.status !== "recruiting";
  const roles = post.roles.map((role) => mdEscape(role.name)).join(" · ");

  const terms = [
    collabRateLine(post),
    post.jam && jamUrlOnSite ? mdLink(post.jam.title, jamUrlOnSite) : null,
    isClosed ? "**No longer recruiting**" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // A team post is posted *by the team* — the same rule the feed mirror's
  // byline follows. Only a solo post names the person.
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
      section(
        textDisplay(
          [`## ${mdLink(post.title, url)}`, roles ? `**Looking for** ${roles}` : null, terms]
            .filter(Boolean)
            .join("\n"),
        ),
        // Stored avatars resolve to site-relative `/images/<key>`, which has
        // to be absolute before Discord's crawler ever sees it.
        thumbnail(
          post.team?.avatarUrl
            ? siteUrl(post.team.avatarUrl)
            : authorAvatarUrl
              ? siteUrl(authorAvatarUrl)
              : null,
        ),
      ),
      textDisplay(mdEscape(description)),
      mediaGallery(
        [
          { url: galleryImage(post.project?.imageUrl), description: post.project?.title },
          ...post.images.map((image) => ({
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

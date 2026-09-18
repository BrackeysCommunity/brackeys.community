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
  textDisplay,
  thumbnail,
} from "@/lib/discord-embed";
import { formatCount } from "@/lib/format-count";
import { collabRateLine, type CollabRateSource } from "@/lib/format-rate";
import { effectiveJamState } from "@/lib/jam-countdown";
import { hostName, jamDateRange, jamSlug, jamUrl } from "@/lib/jam-links";
import { safeThemeColor } from "@/lib/jam-palette";
import { profileSlug } from "@/lib/profile-links";
import { socialImage } from "@/lib/site-meta";
import { teamSlug } from "@/lib/team-links";

export interface JamPreviewSource {
  slug: string;
  title: string;
  bannerUrl: string | null;
  themeColor: string | null;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  votingEndsAt: Date | string | null;
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
 * A jam page's preview: phase, window, host, how much of the jam we hold,
 * and the two places to go next.
 *
 * Dates render as absolute UTC rather than Discord's live `<t:…:R>` markup.
 * A preview is built once, when the link is first pasted, and then sits in
 * the channel forever — so until the relative form is confirmed to render
 * inside a component embed, a date that stays true beats a countdown that
 * might not.
 */
export function jamLinkPreview(
  jam: JamPreviewSource,
  trackedEntries: number,
  now: Date = new Date(),
): Container | null {
  const url = siteUrl(`/jams/${jam.slug}`);
  const phase = PHASE_LABEL[effectiveJamState(jam.startsAt, jam.endsAt, now, jam.votingEndsAt)];
  const status = [`**${phase}**`, jamDateRange(jam.startsAt, jam.endsAt)]
    .filter(Boolean)
    .join(" · ");
  const facts = [
    jam.hosts[0] ? `Hosted by ${mdEscape(hostName(jam))}` : null,
    trackedEntries > 0 ? `${formatCount(trackedEntries)} submissions tracked here` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return container(
    [
      section(
        textDisplay([`## ${mdLink(jam.title, url)}`, status, facts].filter(Boolean).join("\n")),
        // The banner goes through `socialImage` so Discord fetches a resized
        // copy from our own origin: itch's CDN 403s often enough that
        // hotlinking it would cost us the image, and a missing image inside
        // a payload costs the whole layout.
        jam.bannerUrl
          ? thumbnail(socialImage(jam.bannerUrl).url, { description: jam.title })
          : null,
      ),
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
  project: { imageUrl: string | null } | null;
  author: { id: string; urlStub: string | null } | null;
}

/**
 * A collab post's preview. Carries the same vocabulary as the feed mirror
 * in `collab-discord-feed.ts` — looking for, terms, and the same three
 * buttons in the same order — so a post reads identically whether its
 * author shared it deliberately or someone just dropped the link.
 *
 * `authorName` and `avatarUrl` come from the caller because both are
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
    post.responseCount > 0 ? `${post.responseCount} applied` : null,
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

  const face = post.project?.imageUrl ?? post.team?.avatarUrl ?? authorAvatarUrl;

  return container(
    [
      section(
        textDisplay(
          [
            `## ${mdLink(post.title, url)}`,
            roles ? `**Looking for** ${roles}` : null,
            terms,
            byline,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        // Stored images resolve to site-relative `/images/<key>`, which has
        // to be absolute before Discord's crawler ever sees it.
        thumbnail(face ? siteUrl(face) : null),
      ),
      textDisplay(mdEscape(description)),
      mediaGallery(
        post.images.map((image) => ({ url: siteUrl(image.url), description: image.alt })),
      ),
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

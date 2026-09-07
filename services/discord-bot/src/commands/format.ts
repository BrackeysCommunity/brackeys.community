import { effectiveJamState, jamLengthDays } from "../../../../src/lib/jam-countdown.ts";
import { hostName as jamHostName, jamSlug, jamUrl } from "../../../../src/lib/jam-links.ts";
import { profileSlug } from "../../../../src/lib/profile-links.ts";
import { teamSlug } from "../../../../src/lib/team-links.ts";
import { type Button, type Embed, hexColor, httpUrl, plural, siteName, ts } from "../reply.ts";
import { encodeCustomId, type PageState } from "./custom-id.ts";

/**
 * The jam fields every `/jam` embed shares. Typed structurally on the
 * columns the listing, the host series and `getJam` all carry, so one
 * renderer serves all three.
 */
export interface JamLike {
  jamId: number;
  slug: string;
  title: string;
  bannerUrl?: string | null;
  themeColor?: string | null;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  votingEndsAt?: Date | string | null;
  joinedCount?: number | null;
  entriesCount?: number | null;
  hosts?: { name: string }[] | null;
}

export type JamPhase = ReturnType<typeof effectiveJamState>;

export const PHASE_LABEL: Record<JamPhase, string> = {
  upcoming: "UPCOMING",
  running: "SUBMISSIONS OPEN",
  voting: "VOTING",
  ended: "ENDED",
  unknown: "DATES TBA",
};

export function jamPhase(jam: JamLike, now: Date): JamPhase {
  return effectiveJamState(jam.startsAt, jam.endsAt, now, jam.votingEndsAt ?? null);
}

/** "Starts in 3 days" / "Submissions close in 2 hours", as Discord markup. */
export function phaseLine(jam: JamLike, now: Date): string {
  const phase = jamPhase(jam, now);
  switch (phase) {
    case "upcoming":
      return `Starts ${ts(jam.startsAt!)}`;
    case "running":
      return jam.endsAt ? `Submissions close ${ts(jam.endsAt)}` : "Submissions open";
    case "voting":
      return `Voting ends ${ts(jam.votingEndsAt!)}`;
    case "ended": {
      const endedAt = jam.votingEndsAt ?? jam.endsAt;
      return endedAt ? `Ended ${ts(endedAt)}` : "Ended";
    }
    case "unknown":
      return "Dates to be announced";
  }
}

/**
 * An image URL fit for an embed. The public API returns site-relative
 * paths for anything uploaded to the site (`/images/team-avatars/…`) and
 * absolute ones for Discord's CDN and itch.io; Discord accepts only the
 * latter, and rejects the entire message otherwise.
 */
export function mediaUrl(appUrl: string, url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return httpUrl(url.startsWith("/") ? `${appUrl}${url}` : url);
}

/**
 * Prev/next for a paged listing — omitted entirely on a single page.
 * There, both ends clamp to page 0 and the two buttons encode the *same*
 * `custom_id`, which Discord rejects outright
 * (50035 `COMPONENT_CUSTOM_ID_DUPLICATED`) and takes the whole reply with
 * it. Past one page every pair of clamps differs, so the ends stay
 * disabled-but-present.
 */
export function pagerButtons(state: PageState, pages: number): Button[] {
  if (pages <= 1) return [];
  return [
    {
      kind: "page",
      label: "◀ Previous",
      customId: encodeCustomId({ ...state, page: Math.max(0, state.page - 1) }),
      disabled: state.page === 0,
    },
    {
      kind: "page",
      label: "Next ▶",
      customId: encodeCustomId({ ...state, page: Math.min(pages - 1, state.page + 1) }),
      disabled: state.page + 1 >= pages,
    },
  ];
}

export function jamPageUrl(appUrl: string, jam: { jamId: number; slug?: string | null }): string {
  return `${appUrl}/jams/${jamSlug(jam)}`;
}

export function jamButtons(appUrl: string, jam: JamLike): Button[] {
  return [
    { kind: "link", label: `Open on ${siteName(appUrl)}`, url: jamPageUrl(appUrl, jam) },
    { kind: "link", label: "itch.io", url: jamUrl(jam.slug) },
  ];
}

export interface JamEmbedExtras {
  /** `/jam info` adds the host and length; `/jam now` keeps it lean. */
  detail?: boolean;
  /** Lines appended under the phase — the community count, for one. */
  notes?: string[];
}

export function jamEmbed(
  jam: JamLike,
  ctx: { now: Date; appUrl: string },
  extras: JamEmbedExtras = {},
): Embed {
  const phase = jamPhase(jam, ctx.now);
  const lines = [`**${PHASE_LABEL[phase]}** · ${phaseLine(jam, ctx.now)}`, ...(extras.notes ?? [])];

  const fields: Embed["fields"] = [];
  if (jam.startsAt) fields.push({ name: "Starts", value: ts(jam.startsAt, "D"), inline: true });
  if (jam.endsAt) fields.push({ name: "Ends", value: ts(jam.endsAt, "D"), inline: true });
  if (jam.votingEndsAt) {
    fields.push({ name: "Voting ends", value: ts(jam.votingEndsAt, "D"), inline: true });
  }
  if (extras.detail) {
    if (jam.hosts)
      fields.push({ name: "Host", value: jamHostName({ hosts: jam.hosts }), inline: true });
    const days = jamLengthDays(jam.startsAt, jam.endsAt);
    if (days != null) fields.push({ name: "Length", value: plural(days, "day"), inline: true });
  }
  if (jam.entriesCount != null) {
    fields.push({ name: "Entries", value: jam.entriesCount.toLocaleString("en-US"), inline: true });
  }
  if (jam.joinedCount != null) {
    fields.push({ name: "Joined", value: jam.joinedCount.toLocaleString("en-US"), inline: true });
  }

  return {
    title: jam.title,
    url: jamPageUrl(ctx.appUrl, jam),
    description: lines.join("\n"),
    color: hexColor(jam.themeColor),
    fields,
    image: mediaUrl(ctx.appUrl, jam.bannerUrl),
  };
}

export function profileUrl(appUrl: string, user: { id: string; urlStub?: string | null }): string {
  return `${appUrl}/profile/${profileSlug(user)}`;
}

export function teamUrl(appUrl: string, team: { id: string; slug?: string | null }): string {
  return `${appUrl}/teams/${teamSlug(team)}`;
}

export function postUrl(appUrl: string, postId: number): string {
  return `${appUrl}/collab/${postId}`;
}

/** The profile name the site shows: guild nickname, then Discord username. */
export function displayName(p: {
  guildNickname?: string | null;
  discordUsername?: string | null;
}): string {
  return p.guildNickname?.trim() || p.discordUsername?.trim() || "Member";
}

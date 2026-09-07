import { jamEntryUrl } from "../../../../src/lib/jam-links.ts";
import type { PublicApi } from "../api.ts";
import {
  type Embed,
  embedReply,
  link,
  notFound,
  oneLine,
  plural,
  type Reply,
  ts,
} from "../reply.ts";
import type { CommandContext } from "./context.ts";
import { type JamEntrySort, type PageState, truncateSearch } from "./custom-id.ts";
import {
  PHASE_LABEL,
  jamButtons,
  jamEmbed,
  jamPageUrl,
  jamPhase,
  pagerButtons,
  type JamLike,
} from "./format.ts";

type HostJams = Awaited<ReturnType<PublicApi["listJamsByHost"]>>["jams"];
type JamDetail = NonNullable<Awaited<ReturnType<PublicApi["getJam"]>>>;

export const ENTRIES_PAGE_SIZE = 10;
const RESULTS_TOP_N = 5;
const RESULTS_TITLE_MAX = 60;
const ENTRY_TITLE_MAX = 60;
const ENTRY_AUTHOR_MAX = 30;

/**
 * The jam a `/jam now` should show: a running jam beats one in voting,
 * which beats the next upcoming one; with nothing live, the most recently
 * finished edition. Ties go to the nearest boundary.
 */
export function pickCurrentJam<T extends JamLike>(jams: readonly T[], now: Date): T | null {
  const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : Number.NaN);
  const by = (phase: ReturnType<typeof jamPhase>) => jams.filter((j) => jamPhase(j, now) === phase);

  const running = by("running").sort((a, b) => time(a.endsAt) - time(b.endsAt));
  if (running[0]) return running[0];
  const voting = by("voting").sort((a, b) => time(a.votingEndsAt) - time(b.votingEndsAt));
  if (voting[0]) return voting[0];
  const upcoming = by("upcoming").sort((a, b) => time(a.startsAt) - time(b.startsAt));
  if (upcoming[0]) return upcoming[0];
  const ended = by("ended").sort(
    (a, b) => time(b.votingEndsAt ?? b.endsAt) - time(a.votingEndsAt ?? a.endsAt),
  );
  return ended[0] ?? jams[0] ?? null;
}

export async function jamNow(api: PublicApi, ctx: CommandContext): Promise<Reply> {
  const { jams } = await api.listJamsByHost({ hostName: ctx.hostName, limit: 12 });
  const jam = pickCurrentJam(jams as HostJams, ctx.now);
  if (!jam) return notFound(`No jams by ${ctx.hostName} are tracked yet.`);
  return embedReply(jamEmbed(jam, ctx), {
    buttons: jamButtons(ctx.appUrl, jam),
    // The one command that is posted *for* the channel.
    ephemeral: false,
  });
}

/** `getJam` by slug or id; `null` is "no such jam", never an error. */
async function resolveJam(api: PublicApi, idOrSlug: string): Promise<JamDetail | null> {
  const trimmed = idOrSlug.trim();
  if (!trimmed) return null;
  return api.getJam({ idOrSlug: trimmed.slice(0, 300) });
}

const noSuchJam = (idOrSlug: string) =>
  notFound(
    `No jam called **${oneLine(idOrSlug, 80)}** — try the autocomplete, or paste the itch.io slug.`,
  );

export async function jamInfo(
  api: PublicApi,
  input: { jam: string; share?: boolean },
  ctx: CommandContext,
): Promise<Reply> {
  const detail = await resolveJam(api, input.jam);
  if (!detail) return noSuchJam(input.jam);
  const { jam } = detail;

  // A secondary read: its failure costs one line, not the reply.
  const community = await api.getJamCommunity({ jamId: jam.jamId }).catch(() => null);
  const notes: string[] = [];
  if (community) {
    const phase = jamPhase(jam, ctx.now);
    const finished = phase === "ended" || phase === "voting";
    const people = finished ? community.members.length : community.declaredCount;
    const parts: string[] = [];
    if (people > 0) {
      parts.push(
        `${plural(people, "member")} from this server ${finished ? "entered" : people === 1 ? "is entering" : "are entering"}`,
      );
    }
    if (community.teams.length > 0) parts.push(plural(community.teams.length, "team"));
    if (community.openPostCount > 0) {
      parts.push(
        link(
          plural(community.openPostCount, "open team post"),
          `${ctx.appUrl}/collab?jam=${jam.jamId}`,
        ),
      );
    }
    if (parts.length > 0) notes.push(parts.join(" · "));
  }
  if (detail.trackedEntries > 0) {
    notes.push(
      `${plural(detail.trackedEntries, "entry", "entries")} tracked${detail.hasResults ? " · results in" : ""}`,
    );
  }

  return embedReply(jamEmbed(jam, ctx, { detail: true, notes }), {
    buttons: jamButtons(ctx.appUrl, jam),
    ephemeral: !input.share,
  });
}

export interface JamEntriesInput {
  jam: string;
  sort?: JamEntrySort;
  search?: string;
  share?: boolean;
}

export async function jamEntries(
  api: PublicApi,
  input: JamEntriesInput,
  ctx: CommandContext,
): Promise<Reply> {
  const detail = await resolveJam(api, input.jam);
  if (!detail) return noSuchJam(input.jam);
  const state: PageState = {
    kind: "jam_entries",
    jamId: detail.jam.jamId,
    sort: input.sort ?? "rank",
    page: 0,
    search: truncateSearch(input.search),
  };
  return renderEntriesPage(api, detail.jam, state, ctx, !input.share);
}

/** A page turn: the button carries the state, the jam is re-read (cached). */
export async function jamEntriesPage(
  api: PublicApi,
  state: Extract<PageState, { kind: "jam_entries" }>,
  ctx: CommandContext,
  ephemeral: boolean,
): Promise<Reply> {
  const detail = await resolveJam(api, String(state.jamId));
  if (!detail) return notFound("That jam is no longer tracked.");
  return renderEntriesPage(api, detail.jam, state, ctx, ephemeral);
}

async function renderEntriesPage(
  api: PublicApi,
  jam: JamDetail["jam"],
  state: Extract<PageState, { kind: "jam_entries" }>,
  ctx: CommandContext,
  ephemeral: boolean,
): Promise<Reply> {
  const { entries, total } = await api.listJamEntries({
    jamId: state.jamId,
    page: state.page,
    pageSize: ENTRIES_PAGE_SIZE,
    sortBy: state.sort,
    search: state.search,
  });
  const pages = Math.max(1, Math.ceil(total / ENTRIES_PAGE_SIZE));
  const filter = state.search ? ` matching **${state.search}**` : "";

  const rows = entries.map((entry, i) => {
    const n = state.page * ENTRIES_PAGE_SIZE + i + 1;
    const url = entry.rateUrl
      ? jamEntryUrl(entry.rateUrl)
      : (entry.gameUrl ?? jamPageUrl(ctx.appUrl, jam));
    const bits = [
      `**${n}.** ${link(oneLine(entry.gameTitle, ENTRY_TITLE_MAX) || "Untitled", url)}`,
    ];
    if (entry.authorName) bits.push(oneLine(entry.authorName, ENTRY_AUTHOR_MAX));
    const tail: string[] = [];
    if (entry.rank != null) tail.push(`#${entry.rank}`);
    if (entry.ratingCount) tail.push(plural(entry.ratingCount, "rating"));
    if (entry.members.length > 0) tail.push("from this server");
    return [bits.join(" — "), tail.join(" · ")].filter(Boolean).join(" · ");
  });

  const embed: Embed = {
    title: `Entries — ${jam.title}`,
    url: jamPageUrl(ctx.appUrl, jam),
    description: rows.length > 0 ? rows.join("\n") : `No entries${filter} yet.`,
    footer: `Page ${state.page + 1}/${pages} · ${plural(total, "entry", "entries")} · by ${state.sort}`,
  };

  return embedReply(embed, {
    buttons: [
      ...pagerButtons(state, pages),
      { kind: "link", label: "All entries", url: jamPageUrl(ctx.appUrl, jam) },
    ],
    ephemeral,
  });
}

export async function jamResults(
  api: PublicApi,
  input: { jam: string; share?: boolean },
  ctx: CommandContext,
): Promise<Reply> {
  const detail = await resolveJam(api, input.jam);
  if (!detail) return noSuchJam(input.jam);
  const { jam } = detail;
  const notYet = () => {
    const phase = jamPhase(jam, ctx.now);
    const why =
      phase === "upcoming"
        ? `it starts ${ts(jam.startsAt!)}`
        : phase === "running"
          ? `submissions close ${ts(jam.endsAt!)}`
          : phase === "voting"
            ? `voting ends ${ts(jam.votingEndsAt!)}`
            : "itch.io hasn't published them, or we haven't scraped them yet";
    return embedReply(
      {
        title: `Results — ${jam.title}`,
        url: jamPageUrl(ctx.appUrl, jam),
        description: `**${PHASE_LABEL[phase]}** · Results aren't in yet — ${why}.`,
      },
      { buttons: jamButtons(ctx.appUrl, jam), ephemeral: !input.share },
    );
  };
  if (!detail.hasResults) return notYet();

  const { criteria } = await api.getJamResults({ jamId: jam.jamId, topN: RESULTS_TOP_N });
  if (criteria.length === 0) return notYet();

  const fields = criteria.map((c) => ({
    name: `${c.criterion} · ${c.entrantCount.toLocaleString("en-US")} ranked`,
    value: c.places
      .map((p) => {
        const url = p.rateUrl ? jamEntryUrl(p.rateUrl) : (p.gameUrl ?? jamPageUrl(ctx.appUrl, jam));
        const author = p.authorName ? ` — ${oneLine(p.authorName, ENTRY_AUTHOR_MAX)}` : "";
        return `**#${p.rank}** ${link(oneLine(p.gameTitle, RESULTS_TITLE_MAX) || "Untitled", url)}${author}`;
      })
      .join("\n"),
  }));

  return embedReply(
    {
      title: `Results — ${jam.title}`,
      url: jamPageUrl(ctx.appUrl, jam),
      description: `Top ${RESULTS_TOP_N} per criterion. The full table is on itch.io.`,
      fields,
    },
    { buttons: jamButtons(ctx.appUrl, jam), ephemeral: !input.share },
  );
}

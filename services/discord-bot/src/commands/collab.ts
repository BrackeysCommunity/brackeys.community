import { postTypeLabelShort } from "../../../../src/lib/collab-vocabulary.ts";
import { formatRate } from "../../../../src/lib/format-rate.ts";
import type { PublicApi } from "../api.ts";
import {
  type Embed,
  type Reply,
  embedReply,
  link,
  notFound,
  oneLine,
  plural,
  siteName,
  truncate,
  ts,
} from "../reply.ts";
import type { CommandContext } from "./context.ts";
import { type CollabType, type PageState, truncateSearch } from "./custom-id.ts";
import {
  displayName,
  jamPageUrl,
  mediaUrl,
  pagerButtons,
  postUrl,
  profileUrl,
  teamUrl,
} from "./format.ts";

export const BROWSE_PAGE_SIZE = 10;
const ROW_TITLE_MAX = 70;
const POST_DESCRIPTION_MAX = 1200;
const ROW_SKILLS = 3;

type BrowseState = Extract<PageState, { kind: "collab_browse" }>;

export interface CollabBrowseInput {
  type?: CollabType;
  skillId?: number;
  roleId?: number;
  /** Slug or id, as the autocomplete hands it over; resolved to an id once. */
  jam?: string;
  search?: string;
  share?: boolean;
}

export async function collabBrowse(
  api: PublicApi,
  input: CollabBrowseInput,
  ctx: CommandContext,
): Promise<Reply> {
  let jamId: number | undefined;
  if (input.jam?.trim()) {
    const detail = await api.getJam({ idOrSlug: input.jam.trim().slice(0, 300) });
    if (!detail) return notFound(`No jam called **${oneLine(input.jam, 80)}**.`);
    jamId = detail.jam.jamId;
  }
  const state: BrowseState = {
    kind: "collab_browse",
    type: input.type,
    skillId: input.skillId,
    roleId: input.roleId,
    jamId,
    page: 0,
    search: truncateSearch(input.search),
  };
  return collabBrowsePage(api, state, ctx, !input.share);
}

export async function collabBrowsePage(
  api: PublicApi,
  state: BrowseState,
  ctx: CommandContext,
  ephemeral: boolean,
): Promise<Reply> {
  // Open posts only: a closed one is history, not a lead. The counts run
  // under the same facets as the list, so header and rows cannot disagree.
  const facets = {
    status: "recruiting" as const,
    skillIds: state.skillId != null ? [state.skillId] : undefined,
    roleIds: state.roleId != null ? [state.roleId] : undefined,
    jamId: state.jamId,
    search: state.search || undefined,
  };
  const [{ posts, total }, counts, jam] = await Promise.all([
    api.listPosts({
      ...facets,
      type: state.type,
      limit: BROWSE_PAGE_SIZE,
      offset: state.page * BROWSE_PAGE_SIZE,
    }),
    api.countPostsByType(facets),
    state.jamId != null
      ? api.getJam({ idOrSlug: String(state.jamId) }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const pages = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));

  const filters: string[] = [];
  if (state.type) filters.push(postTypeLabelShort(state.type).toLowerCase());
  if (state.skillId != null)
    filters.push(`skill ${ctx.names?.skill(state.skillId) ?? `#${state.skillId}`}`);
  if (state.roleId != null)
    filters.push(`role ${ctx.names?.role(state.roleId) ?? `#${state.roleId}`}`);
  if (state.jamId != null) filters.push(`jam ${jam?.jam.title ?? `#${state.jamId}`}`);
  if (state.search) filters.push(`“${state.search}”`);

  const header = state.type
    ? `**${plural(total, "open post")}** · ${counts.all.toLocaleString("en-US")} across all types`
    : `**${plural(total, "open post")}** · ${counts.hobby} hobby · ${counts.paid} paid`;
  const filterLine = filters.length > 0 ? `Filters: ${filters.join(" · ")}` : "";

  const rows = posts.map((post) => {
    const bits = [
      `**${link(oneLine(post.title, ROW_TITLE_MAX) || "Untitled", postUrl(ctx.appUrl, post.id))}**`,
      postTypeLabelShort(post.type),
    ];
    const rate = formatRate(post.compensationType, post.compensationMin, post.compensationMax, {
      negotiableLabel: "Negotiable",
    });
    if (rate) bits.push(rate);
    if (post.team) bits.push(link(oneLine(post.team.name, 30), teamUrl(ctx.appUrl, post.team)));
    const skills = post.skills.slice(0, ROW_SKILLS).map((s) => s.name);
    if (post.skills.length > ROW_SKILLS) skills.push(`+${post.skills.length - ROW_SKILLS}`);
    if (skills.length > 0) bits.push(skills.join(", "));
    if (post.createdAt) bits.push(ts(post.createdAt));
    return bits.join(" · ");
  });

  const empty =
    filters.length > 0
      ? `Nothing open matches those filters. Loosen one and try again.`
      : "No open posts right now.";

  const embed: Embed = {
    title: "Collab board",
    url: `${ctx.appUrl}/collab`,
    description: [header, filterLine, "", rows.length > 0 ? rows.join("\n") : empty]
      .filter((line, i) => line !== "" || i === 2)
      .join("\n"),
    footer: `Page ${state.page + 1}/${pages}`,
  };

  return embedReply(embed, {
    buttons: [
      ...pagerButtons(state, pages),
      { kind: "link", label: "Open the board", url: `${ctx.appUrl}/collab` },
    ],
    ephemeral,
  });
}

const STATUS_LABEL: Record<string, string> = {
  recruiting: "Recruiting",
  party_full: "Party full",
  closed: "Closed",
  expired: "Expired",
};

export async function collabPost(
  api: PublicApi,
  input: { id: number; share?: boolean },
  ctx: CommandContext,
): Promise<Reply> {
  const post = await api.getPost({ postId: input.id });
  if (!post) return notFound(`No collab post **#${input.id}**.`);

  const fields: Embed["fields"] = [
    { name: "Type", value: postTypeLabelShort(post.type), inline: true },
  ];
  const rate =
    formatRate(post.compensationType, post.compensationMin, post.compensationMax, {
      negotiableLabel: "Negotiable",
    }) || post.compensation;
  if (rate) fields.push({ name: "Compensation", value: oneLine(rate, 100), inline: true });
  fields.push({ name: "Status", value: STATUS_LABEL[post.status] ?? post.status, inline: true });
  if (post.roles.length > 0) {
    fields.push({ name: "Roles wanted", value: post.roles.map((r) => r.name).join(", ") });
  }
  if (post.skills.length > 0) {
    fields.push({ name: "Skills", value: post.skills.map((s) => s.name).join(", ") });
  }
  if (post.team) {
    fields.push({
      name: "Team",
      value: link(post.team.name, teamUrl(ctx.appUrl, post.team)),
      inline: true,
    });
  }
  if (post.jam) {
    fields.push({
      name: "Jam",
      value: link(post.jam.title, jamPageUrl(ctx.appUrl, post.jam)),
      inline: true,
    });
  }
  if (post.createdAt) fields.push({ name: "Posted", value: ts(post.createdAt), inline: true });
  fields.push({ name: "Responses", value: String(post.responseCount), inline: true });

  const author = post.author
    ? {
        name: displayName(post.author),
        url: profileUrl(ctx.appUrl, post.author),
        iconUrl: mediaUrl(ctx.appUrl, post.author.avatarUrl),
      }
    : undefined;

  return embedReply(
    {
      title: post.title,
      url: postUrl(ctx.appUrl, post.id),
      description: truncate(post.description.trim(), POST_DESCRIPTION_MAX),
      author,
      fields,
      image: mediaUrl(ctx.appUrl, post.images[0]?.url ?? post.project?.imageUrl),
    },
    {
      buttons: [
        {
          kind: "link",
          label: `Open on ${siteName(ctx.appUrl)}`,
          url: postUrl(ctx.appUrl, post.id),
        },
      ],
      ephemeral: !input.share,
    },
  );
}

export async function collabStats(
  api: PublicApi,
  input: { share?: boolean },
  ctx: CommandContext,
): Promise<Reply> {
  const [board, teams] = await Promise.all([api.getBoardStats(), api.getTeamStats()]);
  const top = (rows: { name: string; count: number }[]) =>
    rows.length > 0 ? rows.map((r) => `${r.name} (${r.count})`).join(", ") : "—";

  return embedReply(
    {
      title: "Brackeys community, right now",
      url: `${ctx.appUrl}/collab`,
      fields: [
        {
          name: "Open collab posts",
          value: `**${board.open.all}** · ${board.open.hobby} hobby · ${board.open.paid} paid`,
          inline: true,
        },
        { name: "New this week", value: String(board.newThisWeek), inline: true },
        {
          name: "Teams",
          value: `**${teams.active}** active · ${teams.recruiting} recruiting`,
          inline: true,
        },
        { name: "Most wanted skills", value: top(board.topSkills) },
        { name: "Most wanted roles", value: top(board.topRoles) },
      ],
    },
    {
      buttons: [
        { kind: "link", label: "Collab board", url: `${ctx.appUrl}/collab` },
        { kind: "link", label: "Teams", url: `${ctx.appUrl}/teams` },
      ],
      ephemeral: !input.share,
    },
  );
}

import type { PublicApi } from "../api.ts";
import {
  type Embed,
  embedReply,
  link,
  notFound,
  oneLine,
  plural,
  type Reply,
  truncate,
} from "../reply.ts";
import type { CommandContext } from "./context.ts";
import { displayName, mediaUrl, postUrl, teamUrl } from "./format.ts";

const ROSTER_MAX = 15;
const BIO_MAX = 600;
const STACK_MAX = 8;

export async function teamInfo(
  api: PublicApi,
  input: { team: string; share?: boolean },
  ctx: CommandContext,
): Promise<Reply> {
  const handle = input.team.trim();
  if (!handle) return notFound("Type a team name — the autocomplete lists them.");
  const team = await api.getTeam({ teamId: handle.slice(0, 100) });
  if (!team) return notFound(`No team called **${oneLine(handle, 60)}**.`);

  const url = teamUrl(ctx.appUrl, team);
  const roster = team.members.slice(0, ROSTER_MAX).map((m) => {
    // The bot answers inside the guild, so the guild face is the right one.
    const name = displayName(m);
    const tag = m.role === "owner" ? "owner" : m.title;
    return tag ? `${name} · ${oneLine(tag, 30)}` : name;
  });
  if (team.members.length > ROSTER_MAX) roster.push(`+${team.members.length - ROSTER_MAX} more`);

  const fields: Embed["fields"] = [
    { name: `Roster · ${team.members.length}`, value: roster.join("\n") || "—" },
    {
      name: "Recruiting",
      value: team.recruiting
        ? team.openPosts.length > 0
          ? `Yes · ${plural(team.openPosts.length, "open post")}`
          : "Yes"
        : "No",
      inline: true,
    },
    { name: "Showcase", value: plural(team.projects.length, "project"), inline: true },
  ];
  if (team.skills.length > 0) {
    fields.push({
      name: "Stack",
      value: team.skills
        .slice(0, STACK_MAX)
        .map((s) => s.name)
        .join(", "),
    });
  }
  if (team.openPosts.length > 0) {
    fields.push({
      name: "Open posts",
      value: team.openPosts
        .slice(0, 5)
        .map((p) => `• ${link(oneLine(p.title, 60), postUrl(ctx.appUrl, p.id))}`)
        .join("\n"),
    });
  }
  const links = [
    team.websiteUrl && link("Website", team.websiteUrl),
    team.itchUrl && link("itch.io", team.itchUrl),
  ].filter((l): l is string => Boolean(l));
  if (links.length > 0) fields.push({ name: "Links", value: links.join(" · ") });

  const description = [
    team.tagline && `*${oneLine(team.tagline, 200)}*`,
    team.bio && truncate(team.bio.trim(), BIO_MAX),
  ]
    .filter(Boolean)
    .join("\n\n");

  return embedReply(
    {
      title: team.name,
      url,
      description: description || undefined,
      thumbnail: mediaUrl(ctx.appUrl, team.avatarUrl),
      fields,
    },
    { buttons: [{ kind: "link", label: "Open team", url }], ephemeral: !input.share },
  );
}

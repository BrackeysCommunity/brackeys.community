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
  textReply,
  truncate,
} from "../reply.ts";
import type { CommandContext } from "./context.ts";
import { displayName, mediaUrl, profileUrl, teamUrl } from "./format.ts";

type ProfileResult = NonNullable<Awaited<ReturnType<PublicApi["getProfile"]>>>;

const BIO_MAX = 600;
const SKILLS_MAX = 12;
const CANDIDATES_MAX = 5;

/** `/member user:@someone` and the "Brackeys profile" context menu — one
 *  handler, so the two render byte-identical embeds. */
export async function memberByDiscordId(
  api: PublicApi,
  input: { discordId: string; share?: boolean },
  ctx: CommandContext,
): Promise<Reply> {
  const result = await api.getProfileByDiscordId({ discordId: input.discordId });
  if (!result) {
    return notFound(
      // Angle brackets keep the link clickable without Discord unfurling a
      // full preview card underneath a one-line answer.
      `That member isn't on ${siteName(ctx.appUrl)} yet — signing in with Discord at <${ctx.appUrl}> creates their profile.`,
    );
  }
  return renderProfile(api, result, ctx, !input.share);
}

export async function memberByName(
  api: PublicApi,
  input: { name: string; share?: boolean },
  ctx: CommandContext,
): Promise<Reply> {
  const name = input.name.trim().slice(0, 100);
  if (!name) return textReply("Type part of a member's name.");
  const { members } = await api.listMembers({ search: name, limit: CANDIDATES_MAX });
  if (members.length === 0)
    return notFound(`Nobody on ${siteName(ctx.appUrl)} matches **${oneLine(name, 60)}**.`);

  const wanted = name.toLowerCase();
  const exact = members.find(
    (m) => m.guildNickname?.toLowerCase() === wanted || m.discordUsername?.toLowerCase() === wanted,
  );
  const match = exact ?? (members.length === 1 ? members[0] : undefined);
  if (!match) {
    const lines = members.map((m) => `• ${link(displayName(m), profileUrl(ctx.appUrl, m))}`);
    return textReply(
      `Several members match **${oneLine(name, 60)}** — did you mean:\n${lines.join("\n")}`,
    );
  }

  const result = await api.getProfile({ userId: match.id });
  if (!result)
    return notFound(`Nobody on ${siteName(ctx.appUrl)} matches **${oneLine(name, 60)}**.`);
  return renderProfile(api, result, ctx, !input.share);
}

async function renderProfile(
  api: PublicApi,
  result: ProfileResult,
  ctx: CommandContext,
  ephemeral: boolean,
): Promise<Reply> {
  const { profile } = result;
  const teams = await api.listUserTeams({ userId: profile.id }).catch(() => []);
  const url = profileUrl(ctx.appUrl, { id: profile.id, urlStub: result.urlStub });

  const fields: Embed["fields"] = [];
  if (result.roles.length > 0) {
    fields.push({ name: "Roles", value: result.roles.map((r) => r.name).join(", "), inline: true });
  }
  if (result.skills.length > 0) {
    const names = result.skills.slice(0, SKILLS_MAX).map((s) => s.name);
    if (result.skills.length > SKILLS_MAX) names.push(`+${result.skills.length - SKILLS_MAX}`);
    fields.push({ name: "Skills", value: names.join(", ") });
  }
  const rate = formatRate(profile.rateType, profile.rateMin, profile.rateMax, {
    negotiableLabel: "negotiable",
    currency: profile.currency,
  });
  const availability = profile.availableForWork
    ? ["Open to work", profile.availability, rate].filter(Boolean).join(" · ")
    : "Not looking right now";
  fields.push({ name: "Availability", value: availability, inline: true });
  if (profile.timezone || profile.location) {
    fields.push({
      name: "Where",
      value: [profile.location, profile.timezone].filter(Boolean).join(" · "),
      inline: true,
    });
  }
  const shipped = result.projects.length + result.credits.length;
  fields.push({ name: "Shipped", value: plural(shipped, "project"), inline: true });
  if (result.collabsCount > 0) {
    fields.push({
      name: "Collaborated with",
      value: plural(result.collabsCount, "member"),
      inline: true,
    });
  }
  if (teams.length > 0) {
    fields.push({
      name: "Teams",
      value: teams.map((t) => link(t.name, teamUrl(ctx.appUrl, t))).join(" · "),
    });
  }
  const links = [
    profile.githubUrl && link("GitHub", profile.githubUrl),
    profile.twitterUrl && link("Twitter", profile.twitterUrl),
    profile.websiteUrl && link("Website", profile.websiteUrl),
  ].filter((l): l is string => Boolean(l));
  if (links.length > 0) fields.push({ name: "Links", value: links.join(" · ") });

  return embedReply(
    {
      author: {
        name: displayName(profile),
        url,
        iconUrl: mediaUrl(ctx.appUrl, profile.guildAvatarUrl ?? profile.avatarUrl),
      },
      title: profile.tagline ? oneLine(profile.tagline, 200) : undefined,
      url,
      description: profile.bio ? truncate(profile.bio.trim(), BIO_MAX) : undefined,
      thumbnail: mediaUrl(ctx.appUrl, profile.guildAvatarUrl ?? profile.avatarUrl),
      fields,
    },
    { buttons: [{ kind: "link", label: "Open profile", url }], ephemeral },
  );
}

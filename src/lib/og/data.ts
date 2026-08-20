/** What each kind of page puts on its card. Every card degrades rather than fails. */
import { htmlToPlainText } from "@/components/ui/typography";
import { itchOriginalUrl } from "@/lib/itch-image";
import { memberName } from "@/lib/member-name";
import { type OgArt, type OgCardInput, type OgKind, type OgStat } from "@/lib/og/card";
import { client } from "@/orpc/client";

const MAX_ART_BYTES = 8 * 1024 * 1024;
const ART_TIMEOUT_MS = 4000;

const NUM = new Intl.NumberFormat("en-US");

/** The rasterizer cannot fetch, so art is inlined here — bounded, since this is the request path. */
export async function fetchArt(
  url: string | null | undefined,
  shape: OgArt["shape"],
): Promise<OgArt | null> {
  if (!url) return null;
  // Only absolute http(s): a render has no origin to resolve `/images/<key>` against.
  if (!/^https?:\/\//i.test(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ART_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    // SVG is a script surface, not a picture; never inline a remote one.
    if (type.includes("svg")) return null;

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_ART_BYTES) return null;
    const base64 = Buffer.from(buffer).toString("base64");
    return { dataUri: `data:${type.split(";")[0]};base64,${base64}`, shape };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function coverSource(url: string | null | undefined): string | null {
  if (!url) return null;
  return itchOriginalUrl(url);
}

function utcDay(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const OG_KINDS: OgKind[] = ["jam", "project", "collab", "profile", "team"];

export function siteCard(): OgCardInput {
  return {
    kind: "site",
    eyebrow: "Community",
    title: "Every game jam worth entering",
    subtitle:
      "The jams, the people making games in them, and the teams looking for someone like you.",
  };
}

export async function jamCard(slug: string): Promise<OgCardInput | null> {
  const detail = await client.getJam({ idOrSlug: slug });
  if (!detail) return null;
  const { jam, trackedEntries } = detail;

  const now = Date.now();
  const starts = jam.startsAt ? new Date(jam.startsAt).getTime() : null;
  const ends = jam.endsAt ? new Date(jam.endsAt).getTime() : null;
  const votingEnds = jam.votingEndsAt ? new Date(jam.votingEndsAt).getTime() : null;
  /** Not `jamPhase`: a jam with no `endsAt` runs open-endedly rather than
   * falling into the archive, and one with no dates at all gets no status. */
  const state =
    starts == null && ends == null
      ? null
      : starts != null && now < starts
        ? "Upcoming"
        : ends != null && now > ends
          ? votingEnds != null && now < votingEnds
            ? "Voting"
            : "Ended"
          : "Running";

  const window =
    jam.startsAt && jam.endsAt
      ? `${utcDay(jam.startsAt)} – ${utcDay(jam.endsAt)}`
      : jam.startsAt
        ? `Opens ${utcDay(jam.startsAt)}`
        : null;
  const host = jam.hosts[0]?.name;

  const stats: OgStat[] = [];
  const entries = jam.entriesCount ?? trackedEntries;
  if (entries > 0) stats.push({ value: NUM.format(entries), label: "Entries" });
  if (jam.ratingsCount) stats.push({ value: NUM.format(jam.ratingsCount), label: "Ratings" });
  if (state) stats.push({ value: state, label: "Status" });

  return {
    kind: "jam",
    eyebrow: "Game jam",
    title: jam.title,
    subtitle: [window, host && `Hosted by ${host}`].filter(Boolean).join(" · ") || null,
    stats,
    art: await fetchArt(coverSource(jam.bannerUrl), "panel"),
  };
}

export async function projectCard(slug: string): Promise<OgCardInput | null> {
  const detail = await client.getProject({ idOrSlug: slug });
  if (!detail) return null;
  const { project, contributors, jamRecord } = detail;

  const credits = contributors
    .slice(0, 3)
    .map((contributor) => contributor.displayName)
    .join(", ");

  const stats: OgStat[] = [];
  if (jamRecord.length > 0) {
    stats.push({ value: String(jamRecord.length), label: jamRecord.length === 1 ? "Jam" : "Jams" });
  }
  if (contributors.length > 0) {
    stats.push({ value: String(contributors.length), label: "Credits" });
  }
  if (project.releasedAt) {
    stats.push({ value: String(new Date(project.releasedAt).getUTCFullYear()), label: "Released" });
  }

  return {
    kind: "project",
    eyebrow: project.type ?? "Project",
    title: project.title,
    subtitle: project.description ?? (credits ? `By ${credits}` : null),
    stats,
    art: await fetchArt(coverSource(project.imageUrl), "panel"),
  };
}

export async function collabCard(postId: number): Promise<OgCardInput | null> {
  const post = await client.getPost({ postId });
  if (!post) return null;

  const roles = post.roles
    .slice(0, 3)
    .map((role) => role.name)
    .join(", ");
  const who = post.team?.name ?? (post.author ? memberName(post.author, null) : null);

  const stats: OgStat[] = [];
  if (post.roles.length > 0) {
    stats.push({ value: roles, label: post.roles.length === 1 ? "Role" : "Roles" });
  }
  stats.push({ value: post.type === "paid" ? "Paid" : "Hobby", label: "Terms" });
  if (who) stats.push({ value: who, label: post.team ? "Team" : "Posted by" });

  return {
    kind: "collab",
    eyebrow: "Open role",
    title: post.title,
    subtitle: htmlToPlainText(post.description, 150) ?? null,
    stats,
    art: await fetchArt(
      coverSource(post.images[0]?.url ?? post.project?.imageUrl ?? post.jam?.bannerUrl),
      "panel",
    ),
  };
}

export async function profileCard(handle: string): Promise<OgCardInput | null> {
  const data = await client.getProfile({ userId: handle });
  if (!data) return null;
  const { profile, roles, skills, projects, collabsCount } = data;

  const craft = roles
    .slice(0, 2)
    .map((role) => role.name)
    .join(" · ");

  const stats: OgStat[] = [];
  if (projects.length > 0) {
    stats.push({
      value: String(projects.length),
      label: projects.length === 1 ? "Project" : "Projects",
    });
  }
  if (collabsCount > 0) stats.push({ value: String(collabsCount), label: "Collabs" });
  if (skills.length > 0) stats.push({ value: String(skills.length), label: "Skills" });

  return {
    kind: "profile",
    eyebrow: craft || "Member",
    title: memberName(profile, "A Brackeys member"),
    subtitle:
      profile.tagline ??
      [profile.location, profile.availableForWork ? "Open to work" : null]
        .filter(Boolean)
        .join(" · ") ??
      null,
    stats,
    art: await fetchArt(profile.avatarUrl, "circle"),
  };
}

export async function teamCard(handle: string): Promise<OgCardInput | null> {
  const team = await client.getTeam({ teamId: handle });
  if (!team) return null;

  const stats: OgStat[] = [
    { value: String(team.members.length), label: team.members.length === 1 ? "Member" : "Members" },
  ];
  if (team.projects.length > 0) {
    stats.push({ value: String(team.projects.length), label: "Shipped" });
  }
  if (team.recruiting) stats.push({ value: "Open", label: "Recruiting" });

  return {
    kind: "team",
    eyebrow: "Team",
    title: team.name,
    subtitle: team.tagline ?? null,
    stats,
    art: await fetchArt(
      coverSource(team.bannerUrl ?? team.avatarUrl),
      team.bannerUrl ? "panel" : "circle",
    ),
  };
}

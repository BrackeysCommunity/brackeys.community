import { os } from "@orpc/server";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import * as z from "zod";

import { jamPhase } from "@/components/jams/JamCalendarPage/helpers";
import { db } from "@/db";
import {
  collabPosts,
  developerProfiles,
  forumPostTags,
  forumPosts,
  forumTags,
  itchJamEntries,
  itchJams,
  profileUrlStubs,
  projects,
  teams,
  user,
} from "@/db/schema";
import { isActiveBan } from "@/lib/ban-state";
import { forumPostParam, forumPostTitle } from "@/lib/forum-posts";
import { ANON_VIEWER, memberAvatarUrl, memberDisplayName } from "@/lib/member-name";
import { ANONYMOUS_FLAG_DISTINCT_ID, isServerFlagEnabled } from "@/lib/posthog-server";
import {
  getProfileProjectImageUrl,
  resolveTeamAvatarUrl,
} from "@/lib/profile-project-image-storage";
import {
  fuseResults,
  isExactMatch,
  SEARCH_KINDS,
  type KindResult,
  type SearchKind,
} from "@/lib/search-hits";
import { fuzzyMatch, fuzzyRank } from "@/lib/sql-fuzzy";
import { readSession } from "@/orpc/middleware/auth";
import { forumTextSearch, listableWhere } from "@/orpc/router/forum";

/**
 * Entries are the one corpus too big to rank well by trigram alone, so the
 * Postgres path searches only jams that are live or ended recently. The
 * full corpus arrives with the search engine.
 */
const ENTRY_WINDOW = sql`interval '90 days'`;

type KindSearch = (q: string, limit: number, viewerId: string | null) => Promise<KindResult>;

const searchJams: KindSearch = async (q, limit) => {
  const rank = fuzzyRank([itchJams.title], q, { fold: true });
  const rows = await db
    .select({
      jamId: itchJams.jamId,
      slug: itchJams.slug,
      title: itchJams.title,
      hashtag: itchJams.hashtag,
      bannerUrl: itchJams.bannerUrl,
      themeColor: itchJams.themeColor,
      startsAt: itchJams.startsAt,
      endsAt: itchJams.endsAt,
      votingEndsAt: itchJams.votingEndsAt,
      entriesCount: itchJams.entriesCount,
    })
    .from(itchJams)
    .where(
      and(
        isNull(itchJams.missingSince),
        or(fuzzyMatch(itchJams.title, q, { fold: true }), fuzzyMatch(itchJams.hashtag, q)),
      ),
    )
    // Among equally good titles, the live or newest edition first — "gmtk"
    // means this year's GMTK.
    .orderBy(desc(rank), desc(itchJams.startsAt))
    .limit(limit);
  const now = new Date();
  return {
    kind: "jam",
    hits: rows.map((row) => {
      const dates = {
        startsAt: row.startsAt?.toISOString() ?? null,
        endsAt: row.endsAt?.toISOString() ?? null,
        votingEndsAt: row.votingEndsAt?.toISOString() ?? null,
      };
      return {
        kind: "jam",
        id: row.jamId,
        slug: row.slug,
        title: row.title,
        phase: jamPhase(row, now),
        ...dates,
        bannerUrl: row.bannerUrl,
        themeColor: row.themeColor,
        entriesCount: row.entriesCount,
        href: `/jams/${row.slug}`,
        exact: isExactMatch(q, [row.title, row.hashtag, row.slug]),
      };
    }),
  };
};

const searchEntries: KindSearch = async (q, limit) => {
  const rows = await db
    .select({
      entryId: itchJamEntries.entryId,
      gameId: itchJamEntries.gameId,
      jamId: itchJamEntries.jamId,
      title: itchJamEntries.gameTitle,
      author: itchJamEntries.authorName,
      coverUrl: itchJamEntries.gameCoverUrl,
      coverColor: itchJamEntries.gameCoverColor,
      jamTitle: itchJams.title,
    })
    .from(itchJamEntries)
    .innerJoin(itchJams, eq(itchJamEntries.jamId, itchJams.jamId))
    .where(
      and(
        isNull(itchJamEntries.missingSince),
        isNull(itchJams.missingSince),
        gt(
          sql`coalesce(${itchJams.votingEndsAt}, ${itchJams.endsAt})`,
          sql`now() - ${ENTRY_WINDOW}`,
        ),
        fuzzyMatch(itchJamEntries.gameTitle, q),
      ),
    )
    .orderBy(desc(fuzzyRank([itchJamEntries.gameTitle], q)), desc(itchJamEntries.ratingCount))
    .limit(limit);
  return {
    kind: "entry",
    hits: rows.map((row) => ({
      kind: "entry",
      id: row.entryId,
      gameId: row.gameId,
      jamId: row.jamId,
      title: row.title,
      author: row.author,
      jamTitle: row.jamTitle,
      coverUrl: row.coverUrl,
      coverColor: row.coverColor,
      href: `/projects/game/${row.gameId}?jam=${row.jamId}`,
      exact: isExactMatch(q, [row.title]),
    })),
  };
};

const searchMembers: KindSearch = async (q, limit) => {
  // The @handle is the vanity stub; `discord_username` is a display name.
  const handle = q.replace(/^@/, "");
  const rank = fuzzyRank(
    [
      developerProfiles.guildNickname,
      developerProfiles.discordUsername,
      developerProfiles.discordHandle,
    ],
    handle,
    { fold: true },
  );
  const stubRank = fuzzyRank([profileUrlStubs.stub], handle, { fold: true });
  const rows = await db
    .select({
      id: developerProfiles.id,
      discordUsername: developerProfiles.discordUsername,
      discordHandle: developerProfiles.discordHandle,
      guildNickname: developerProfiles.guildNickname,
      avatarUrl: developerProfiles.avatarUrl,
      guildAvatarUrl: developerProfiles.guildAvatarUrl,
      tagline: developerProfiles.tagline,
      stub: profileUrlStubs.stub,
    })
    .from(developerProfiles)
    .innerJoin(user, eq(user.id, developerProfiles.id))
    .leftJoin(profileUrlStubs, eq(profileUrlStubs.profileId, developerProfiles.id))
    .where(
      and(
        sql`NOT (${user.bannedAt} IS NOT NULL AND ${user.unbannedAt} IS NULL
          AND (${user.bannedUntil} IS NULL OR ${user.bannedUntil} > now()))`,
        or(
          fuzzyMatch(developerProfiles.guildNickname, handle, { fold: true }),
          fuzzyMatch(developerProfiles.discordUsername, handle, { fold: true }),
          fuzzyMatch(developerProfiles.discordHandle, handle, { fold: true }),
          fuzzyMatch(profileUrlStubs.stub, handle, { fold: true }),
        ),
      ),
    )
    .orderBy(desc(sql`greatest(${rank}, coalesce(${stubRank}, 0))`), asc(developerProfiles.id))
    .limit(limit);
  return {
    kind: "member",
    hits: rows.map((row) => ({
      kind: "member",
      id: row.id,
      stub: row.stub,
      name: memberDisplayName(row, ANON_VIEWER, row.stub ?? "Member"),
      avatarUrl: memberAvatarUrl(row, ANON_VIEWER),
      tagline: row.tagline,
      href: `/profile/${row.stub || row.id}`,
      exact: isExactMatch(handle, [
        row.stub,
        row.discordHandle,
        row.discordUsername,
        row.guildNickname,
      ]),
    })),
  };
};

const searchTeams: KindSearch = async (q, limit) => {
  const rows = await db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      tagline: teams.tagline,
      avatarUrl: teams.avatarUrl,
      avatarKey: teams.avatarKey,
      recruiting: teams.recruiting,
    })
    .from(teams)
    .where(
      and(
        eq(teams.status, "active"),
        isNull(teams.hiddenAt),
        or(fuzzyMatch(teams.name, q, { fold: true }), fuzzyMatch(teams.slug, q)),
      ),
    )
    .orderBy(desc(fuzzyRank([teams.name], q, { fold: true })), desc(teams.lastActivityAt))
    .limit(limit);
  const hits = await Promise.all(
    rows.map(async (row) => ({
      kind: "team" as const,
      id: row.id,
      slug: row.slug,
      name: row.name,
      tagline: row.tagline,
      avatarUrl: await resolveTeamAvatarUrl(row),
      recruiting: row.recruiting,
      href: `/teams/${row.slug || row.id}`,
      exact: isExactMatch(q, [row.name, row.slug]),
    })),
  );
  return { kind: "team", hits };
};

const searchCollab: KindSearch = async (q, limit) => {
  const rows = await db
    .select({
      id: collabPosts.id,
      title: collabPosts.title,
      type: collabPosts.type,
      status: collabPosts.status,
      teamName: teams.name,
    })
    .from(collabPosts)
    .leftJoin(teams, and(eq(collabPosts.teamId, teams.id), isNull(teams.hiddenAt)))
    .where(and(ne(collabPosts.status, "expired"), fuzzyMatch(collabPosts.title, q)))
    .orderBy(desc(fuzzyRank([collabPosts.title], q)), desc(collabPosts.createdAt))
    .limit(limit);
  return {
    kind: "collab",
    hits: rows.map((row) => ({
      kind: "collab",
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status,
      teamName: row.teamName,
      href: `/collab/${row.id}`,
      exact: isExactMatch(q, [row.title]),
    })),
  };
};

const searchForum: KindSearch = async (q, limit, viewerId) => {
  const enabled = await isServerFlagEnabled(
    "forum-enabled",
    viewerId ?? ANONYMOUS_FLAG_DISTINCT_ID,
  );
  if (!enabled || q.length < 2) return { kind: "forum", hits: [] };
  const search = forumTextSearch(q);
  const rows = await db
    .select({
      id: forumPosts.id,
      slug: forumPosts.slug,
      title: forumPosts.title,
      excerpt: forumPosts.excerpt,
      kind: forumPosts.kind,
    })
    .from(forumPosts)
    .leftJoin(teams, eq(forumPosts.teamId, teams.id))
    .leftJoin(user, eq(forumPosts.authorId, user.id))
    .where(and(...listableWhere(viewerId), search.match))
    .orderBy(desc(search.rank), desc(forumPosts.publishedAt), desc(forumPosts.id))
    .limit(limit);
  const tagRows =
    rows.length > 0
      ? await db
          .select({ postId: forumPostTags.postId, slug: forumTags.slug })
          .from(forumPostTags)
          .innerJoin(forumTags, eq(forumPostTags.tagId, forumTags.id))
          .where(
            and(
              inArray(
                forumPostTags.postId,
                rows.map((r) => r.id),
              ),
              eq(forumTags.status, "active"),
            ),
          )
          .orderBy(asc(forumTags.slug))
      : [];
  const tagsByPost = new Map<number, string[]>();
  for (const { postId, slug } of tagRows) {
    tagsByPost.set(postId, [...(tagsByPost.get(postId) ?? []), slug]);
  }
  return {
    kind: "forum",
    hits: rows.map((row) => ({
      kind: "forum",
      id: row.id,
      slug: row.slug,
      title: forumPostTitle(row),
      excerpt: row.excerpt,
      postKind: row.kind,
      tags: tagsByPost.get(row.id) ?? [],
      href: `/forum/${forumPostParam(row)}`,
      exact: isExactMatch(q, [row.title]),
    })),
  };
};

const searchProjects: KindSearch = async (q, limit) => {
  const rows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      title: projects.title,
      imageUrl: projects.imageUrl,
      imageKey: projects.imageKey,
    })
    .from(projects)
    .where(
      and(
        eq(projects.published, true),
        or(fuzzyMatch(projects.title, q), fuzzyMatch(projects.slug, q)),
      ),
    )
    .orderBy(desc(fuzzyRank([projects.title, projects.slug], q)), desc(projects.updatedAt))
    .limit(limit);
  const hits = await Promise.all(
    rows.map(async (row) => ({
      kind: "project" as const,
      id: row.id,
      slug: row.slug,
      title: row.title,
      coverUrl: (await getProfileProjectImageUrl(row.imageKey)) ?? row.imageUrl,
      href: `/projects/${row.slug || row.id}`,
      exact: isExactMatch(q, [row.title, row.slug]),
    })),
  );
  return { kind: "project", hits };
};

const SEARCHERS: Record<SearchKind, KindSearch> = {
  jam: searchJams,
  entry: searchEntries,
  member: searchMembers,
  team: searchTeams,
  collab: searchCollab,
  forum: searchForum,
  project: searchProjects,
};

/**
 * One box for the whole site: a small ranked query per kind, run in
 * parallel and merged by rank. Private, not on the cacheable tier — forum
 * results depend on the caller's flag and blocks.
 */
export const searchAll = os
  .input(
    z.object({
      q: z.string().trim().min(1).max(100),
      perKind: z.number().int().min(1).max(10).default(5),
      kinds: z.array(z.enum(SEARCH_KINDS)).max(SEARCH_KINDS.length).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const session = await readSession(context);
    const viewerId = session && !isActiveBan(session.user) ? session.user.id : null;
    const kinds = input.kinds?.length ? [...new Set(input.kinds)] : SEARCH_KINDS;
    const results = await Promise.all(
      kinds.map((kind) => SEARCHERS[kind](input.q, input.perKind, viewerId)),
    );
    return { hits: fuseResults(results), engine: "postgres" as const };
  });

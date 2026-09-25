import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { developerProfiles, forumPosts, teams, user } from "@/db/schema";
import { siteOrigin, siteUrl } from "@/env";
import { forumPostParam, forumPostTitle } from "@/lib/forum-posts";
import { memberName } from "@/lib/member-name";
import { ANONYMOUS_FLAG_DISTINCT_ID, isServerFlagEnabled } from "@/lib/posthog-server";
import { censorText } from "@/lib/profanity";
import { SITE_NAME } from "@/lib/site-meta";
import { escapeXml } from "@/lib/xml";

/**
 * Atom for the forum: `/forum/feed.xml` (every devlog) and a team's own
 * `/teams/<team>/devlog.xml`. Devlog readers live in feed readers, and
 * those are signed out — so, like the sitemap, a feed only exists while
 * the forum is on for the anonymous viewer, and 404s while it's dark.
 */

const FEED_LIMIT = 50;

export function forumFeedsOpen(): Promise<boolean> {
  return isServerFlagEnabled("forum-enabled", ANONYMOUS_FLAG_DISTINCT_ID);
}

const notFound = () => new Response("Not found", { status: 404 });

export async function forumAtomResponse(opts: {
  teamId?: string;
  title: string;
  subtitle: string;
  selfPath: string;
  alternatePath: string;
}): Promise<Response> {
  if (!(await forumFeedsOpen())) return notFound();

  const rows = await db
    .select({
      id: forumPosts.id,
      title: forumPosts.title,
      slug: forumPosts.slug,
      excerpt: forumPosts.excerpt,
      publishedAt: forumPosts.publishedAt,
      editedAt: forumPosts.editedAt,
      teamName: teams.name,
      discordUsername: developerProfiles.discordUsername,
      guildNickname: developerProfiles.guildNickname,
    })
    .from(forumPosts)
    .leftJoin(teams, eq(forumPosts.teamId, teams.id))
    .leftJoin(user, eq(forumPosts.authorId, user.id))
    .leftJoin(developerProfiles, eq(forumPosts.authorId, developerProfiles.id))
    .where(
      and(
        eq(forumPosts.kind, "devlog"),
        eq(forumPosts.status, "published"),
        isNull(forumPosts.deletedAt),
        isNull(forumPosts.hiddenAt),
        isNull(teams.hiddenAt),
        // A banned author's devlogs leave the feed the way they leave the forum.
        or(
          isNull(user.bannedAt),
          sql`${user.unbannedAt} IS NOT NULL`,
          sql`${user.bannedUntil} <= now()`,
        ),
        opts.teamId ? eq(forumPosts.teamId, opts.teamId) : undefined,
      ),
    )
    .orderBy(desc(forumPosts.publishedAt), desc(forumPosts.id))
    .limit(FEED_LIMIT);

  const self = siteUrl(opts.selfPath);
  const stamp = (row: (typeof rows)[number]) => row.editedAt ?? row.publishedAt ?? new Date(0);
  const updated = rows.reduce<Date | null>(
    (latest, row) => (!latest || stamp(row) > latest ? stamp(row) : latest),
    null,
  );

  const entries = rows.map((row) => {
    const url = siteUrl(`/forum/${forumPostParam(row)}`);
    const author = row.teamName ?? memberName(row, "A member");
    const summary = censorText(row.excerpt);
    return [
      "  <entry>",
      `    <id>${escapeXml(`${siteOrigin()}/forum/${row.id}`)}</id>`,
      `    <title>${escapeXml(censorText(forumPostTitle(row)))}</title>`,
      `    <link rel="alternate" type="text/html" href="${escapeXml(url)}"/>`,
      row.publishedAt ? `    <published>${row.publishedAt.toISOString()}</published>` : "",
      `    <updated>${stamp(row).toISOString()}</updated>`,
      `    <author><name>${escapeXml(author)}</name></author>`,
      summary ? `    <summary>${escapeXml(summary)}</summary>` : "",
      "  </entry>",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const body = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom">`,
    `  <title>${escapeXml(opts.title)}</title>`,
    `  <subtitle>${escapeXml(opts.subtitle)}</subtitle>`,
    `  <id>${escapeXml(self)}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(siteUrl(opts.alternatePath))}"/>`,
    `  <author><name>${escapeXml(SITE_NAME)}</name></author>`,
    `  <updated>${(updated ?? new Date()).toISOString()}</updated>`,
    ...entries,
    `</feed>`,
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=900",
    },
  });
}

/** A team by slug or id, for its devlog feed; null when hidden or gone. */
export async function feedTeam(handle: string) {
  const [team] = await db
    .select({ id: teams.id, slug: teams.slug, name: teams.name })
    .from(teams)
    .where(and(or(eq(teams.slug, handle), eq(teams.id, handle)), isNull(teams.hiddenAt)))
    .limit(1);
  return team ?? null;
}

export { notFound as forumFeedNotFound };

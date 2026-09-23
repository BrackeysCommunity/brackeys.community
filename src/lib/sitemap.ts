/**
 * `/sitemap.xml` is an index; the URL sets hang off it as
 * `?section=jams&page=0`. Query strings rather than separate files because a
 * child sitemap may only list URLs at or below its own directory, and one
 * route at the site root keeps every child in scope of the whole host.
 */
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  collabPosts,
  developerProfiles,
  forumPosts,
  itchJams,
  profileUrlStubs,
  projects,
  teams,
} from "@/db/schema";
import { siteUrl } from "@/env";
import { forumPostParam } from "@/lib/forum-posts";
import { ANONYMOUS_FLAG_DISTINCT_ID, isServerFlagEnabled } from "@/lib/posthog-server";
import { profileSlug } from "@/lib/profile-links";
import { profileStubJoin } from "@/orpc/profile-projection";

/** URLs per child sitemap. The spec's ceiling is 50,000 / 50 MB. */
export const SITEMAP_PAGE_SIZE = 10_000;

export const SITEMAP_SECTIONS = [
  "static",
  "jams",
  "projects",
  "profiles",
  "teams",
  "collab",
  "forum",
] as const;

export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

export function isSitemapSection(value: string): value is SitemapSection {
  return (SITEMAP_SECTIONS as readonly string[]).includes(value);
}

export interface SitemapUrl {
  path: string;
  lastmod?: Date | null;
  changefreq?: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
}

/**
 * `/command-center`, `/game` and `/profile` are absent on purpose: they
 * answer a generic shell to an anonymous crawler, as `robots.txt` also says.
 */
const STATIC_URLS: SitemapUrl[] = [
  { path: "/", changefreq: "daily", priority: 1 },
  { path: "/jams", changefreq: "daily", priority: 0.9 },
  { path: "/jams/calendar", changefreq: "daily", priority: 0.7 },
  { path: "/jams/archive", changefreq: "weekly", priority: 0.7 },
  { path: "/collab", changefreq: "daily", priority: 0.9 },
  { path: "/members", changefreq: "daily", priority: 0.8 },
  { path: "/teams", changefreq: "daily", priority: 0.8 },
  { path: "/terms", changefreq: "yearly", priority: 0.3 },
  { path: "/privacy", changefreq: "yearly", priority: 0.3 },
];

async function sectionCount(section: SitemapSection): Promise<number> {
  const [row] = await sectionCountQuery(section);
  return Number(row?.count ?? 0);
}

function sectionCountQuery(section: SitemapSection) {
  const count = sql<number>`count(*)::int`;
  switch (section) {
    case "static":
      return Promise.resolve([{ count: STATIC_URLS.length }]);
    case "jams":
      return db.select({ count }).from(itchJams).where(isNull(itchJams.missingSince));
    case "projects":
      return db.select({ count }).from(projects).where(indexableProjectFilter());
    case "profiles":
      return db.select({ count }).from(developerProfiles);
    case "teams":
      return db.select({ count }).from(teams);
    case "collab":
      return db.select({ count }).from(collabPosts).where(livePostFilter());
    case "forum":
      return forumCrawlable().then((open) =>
        open
          ? db
              .select({ count })
              .from(forumPosts)
              .leftJoin(teams, eq(forumPosts.teamId, teams.id))
              .where(liveForumPostFilter())
          : [{ count: 0 }],
      );
  }
}

/**
 * Crawlers are signed out, so the forum is in the sitemap only while the
 * flag is on for anonymous visitors — otherwise every URL here would 404.
 * The section stays in the index either way and answers empty.
 */
function forumCrawlable(): Promise<boolean> {
  return isServerFlagEnabled("forum-enabled", ANONYMOUS_FLAG_DISTINCT_ID);
}

/** Published, not deleted or hidden, not under a hidden team. Needs `teams` joined. */
function liveForumPostFilter() {
  return and(
    eq(forumPosts.status, "published"),
    isNull(forumPosts.deletedAt),
    isNull(forumPosts.hiddenAt),
    isNull(teams.hiddenAt),
  );
}

/** Every post renders, but an expired one is a closed door. */
function livePostFilter() {
  return ne(collabPosts.status, "expired");
}

/**
 * The SQL twin of `getProject`'s `indexable`. The two have to agree — a page
 * that carries `noindex` must not be advertised here.
 */
function indexableProjectFilter() {
  return and(
    eq(projects.published, true),
    sql`(
      ${projects.createdBy} is not null
      or exists (select 1 from "user"."profile_projects" pp where pp."project_id" = ${projects.id})
      or exists (select 1 from "team"."team_projects" tp where tp."project_id" = ${projects.id})
      or exists (select 1 from "project"."project_teams" pt where pt."project_id" = ${projects.id})
      or exists (
        select 1 from "project"."project_contributors" pc
        where pc."project_id" = ${projects.id} and pc."profile_id" is not null
      )
      or (
        ${projects.sourceGameId} is not null
        and (
          select count(*) from "itch"."jam_entries" e
          join "itch"."jams" j on j."jam_id" = e."jam_id"
          where e."game_id" = ${projects.sourceGameId}
            and e."missing_since" is null
            and j."missing_since" is null
        ) > 1
      )
    )`,
  );
}

async function sectionUrls(section: SitemapSection, page: number): Promise<SitemapUrl[]> {
  const offset = page * SITEMAP_PAGE_SIZE;
  switch (section) {
    case "static":
      return STATIC_URLS;

    case "jams": {
      const rows = await db
        .select({ slug: itchJams.slug, updatedAt: itchJams.updatedAt, endsAt: itchJams.endsAt })
        .from(itchJams)
        .where(isNull(itchJams.missingSince))
        .orderBy(asc(itchJams.jamId))
        .limit(SITEMAP_PAGE_SIZE)
        .offset(offset);
      const now = Date.now();
      return rows.map((row) => ({
        path: `/jams/${encodeURIComponent(row.slug)}`,
        lastmod: row.updatedAt,
        changefreq: row.endsAt && row.endsAt.getTime() < now ? "yearly" : "daily",
      }));
    }

    case "projects": {
      const rows = await db
        .select({ slug: projects.slug, updatedAt: projects.updatedAt })
        .from(projects)
        .where(indexableProjectFilter())
        .orderBy(asc(projects.id))
        .limit(SITEMAP_PAGE_SIZE)
        .offset(offset);
      return rows.map((row) => ({
        path: `/projects/${encodeURIComponent(row.slug)}`,
        lastmod: row.updatedAt,
        changefreq: "monthly",
      }));
    }

    case "profiles": {
      // The route resolves both forms; advertise the one `profileSlug()`
      // links to, or every profile has two live URLs.
      const rows = await db
        .select({
          id: developerProfiles.id,
          stub: profileUrlStubs.stub,
          updatedAt: developerProfiles.updatedAt,
        })
        .from(developerProfiles)
        .leftJoin(profileUrlStubs, profileStubJoin)
        .orderBy(asc(developerProfiles.id))
        .limit(SITEMAP_PAGE_SIZE)
        .offset(offset);
      return rows.map((row) => ({
        path: `/profile/${encodeURIComponent(profileSlug({ id: row.id, urlStub: row.stub }))}`,
        lastmod: row.updatedAt,
        changefreq: "weekly",
      }));
    }

    case "teams": {
      const rows = await db
        .select({ slug: teams.slug, updatedAt: teams.updatedAt })
        .from(teams)
        .orderBy(asc(teams.id))
        .limit(SITEMAP_PAGE_SIZE)
        .offset(offset);
      return rows.map((row) => ({
        path: `/teams/${encodeURIComponent(row.slug)}`,
        lastmod: row.updatedAt,
        changefreq: "weekly",
      }));
    }

    case "collab": {
      const rows = await db
        .select({ id: collabPosts.id, updatedAt: collabPosts.updatedAt })
        .from(collabPosts)
        .where(livePostFilter())
        .orderBy(asc(collabPosts.id))
        .limit(SITEMAP_PAGE_SIZE)
        .offset(offset);
      return rows.map((row) => ({
        path: `/collab/${row.id}`,
        lastmod: row.updatedAt,
        changefreq: "weekly",
      }));
    }
    case "forum": {
      if (!(await forumCrawlable())) return [];
      const rows = await db
        .select({ id: forumPosts.id, slug: forumPosts.slug, updatedAt: forumPosts.updatedAt })
        .from(forumPosts)
        .leftJoin(teams, eq(forumPosts.teamId, teams.id))
        .where(liveForumPostFilter())
        .orderBy(asc(forumPosts.id))
        .limit(SITEMAP_PAGE_SIZE)
        .offset(offset);
      return [
        ...(page === 0 ? [{ path: "/forum", changefreq: "hourly" as const, priority: 0.8 }] : []),
        ...rows.map((row) => ({
          path: `/forum/${forumPostParam(row)}`,
          lastmod: row.updatedAt,
          changefreq: "weekly" as const,
        })),
      ];
    }
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function childSitemapUrl(section: SitemapSection, page: number): string {
  return siteUrl(`/sitemap.xml?section=${section}&page=${page}`);
}

export async function renderSitemapIndex(): Promise<string> {
  const counts = await Promise.all(
    SITEMAP_SECTIONS.map(async (section) => [section, await sectionCount(section)] as const),
  );

  const entries = counts.flatMap(([section, count]) => {
    // An empty section still gets page 0, which answers as an empty urlset.
    const pages = Math.max(1, Math.ceil(count / SITEMAP_PAGE_SIZE));
    return Array.from({ length: pages }, (_, page) => childSitemapUrl(section, page));
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...entries.map((loc) => `<sitemap><loc>${xmlEscape(loc)}</loc></sitemap>`),
    `</sitemapindex>`,
  ].join("\n");
}

export async function renderSitemapSection(section: SitemapSection, page: number): Promise<string> {
  const urls = await sectionUrls(section, page);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls.map((url) =>
      [
        "<url>",
        `<loc>${xmlEscape(siteUrl(url.path))}</loc>`,
        url.lastmod ? `<lastmod>${url.lastmod.toISOString()}</lastmod>` : "",
        url.changefreq ? `<changefreq>${url.changefreq}</changefreq>` : "",
        url.priority != null ? `<priority>${url.priority}</priority>` : "",
        "</url>",
      ]
        .filter(Boolean)
        .join(""),
    ),
    `</urlset>`,
  ].join("\n");
}

/**
 * One-time (but re-runnable) sweep: null every member-supplied link stored
 * under a scheme the app will no longer render.
 *
 * Until plan `33` §0.1 every one of these columns was guarded by a bare
 * `z.url()`, which accepts `javascript:`, `data:`, `vbscript:` and `file:`
 * as readily as `https:`. The schemas now refuse them at the door and
 * `ExternalLink` renders nothing for a URL it can't parse, but rows written
 * before that still hold whatever was saved and a few call sites still hand
 * the raw string to an `href`.
 *
 *   railway run -- bun scripts/null-unsafe-links.ts            # apply
 *   railway run -- bun scripts/null-unsafe-links.ts --dry-run  # list only
 *
 * Idempotent: a row whose link already parses as http(s) is left alone.
 * `projects.links` is a jsonb array, so its unsafe entries are dropped from
 * the array rather than the column being cleared.
 */
import { eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  collabResponses,
  collabPosts,
  developerProfiles,
  profileProjects,
  projects,
  teams,
} from "@/db/schema";
import { isExternalUrl } from "@/lib/external-url";

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Every plain-text column holding a link a member typed, each with its own
 * read/clear pair — drizzle's `.set()` takes the JS property name, which a
 * generic column reference doesn't carry. Ids are widened because one of
 * these tables keys on an integer and the rest on text.
 */
interface LinkColumn {
  name: string;
  read: () => Promise<{ id: string | number; value: string | null }[]>;
  clear: (id: string | number) => Promise<unknown>;
}

const TEXT_COLUMNS: LinkColumn[] = [
  {
    name: "teams.website_url",
    read: () =>
      db
        .select({ id: teams.id, value: teams.websiteUrl })
        .from(teams)
        .where(isNotNull(teams.websiteUrl)),
    clear: (id: string | number) =>
      db
        .update(teams)
        .set({ websiteUrl: null })
        .where(eq(teams.id, String(id))),
  },
  {
    name: "teams.itch_url",
    read: () =>
      db.select({ id: teams.id, value: teams.itchUrl }).from(teams).where(isNotNull(teams.itchUrl)),
    clear: (id: string | number) =>
      db
        .update(teams)
        .set({ itchUrl: null })
        .where(eq(teams.id, String(id))),
  },
  {
    name: "projects.url",
    read: () =>
      db
        .select({ id: projects.id, value: projects.url })
        .from(projects)
        .where(isNotNull(projects.url)),
    clear: (id: string | number) =>
      db
        .update(projects)
        .set({ url: null })
        .where(eq(projects.id, String(id))),
  },
  {
    name: "profile_projects.url",
    read: () =>
      db
        .select({ id: profileProjects.id, value: profileProjects.url })
        .from(profileProjects)
        .where(isNotNull(profileProjects.url)),
    clear: (id: string | number) =>
      db
        .update(profileProjects)
        .set({ url: null })
        .where(eq(profileProjects.id, String(id))),
  },
  {
    name: "collab_posts.portfolio_url",
    read: () =>
      db
        .select({ id: collabPosts.id, value: collabPosts.portfolioUrl })
        .from(collabPosts)
        .where(isNotNull(collabPosts.portfolioUrl)),
    clear: (id: string | number) =>
      db
        .update(collabPosts)
        .set({ portfolioUrl: null })
        .where(eq(collabPosts.id, Number(id))),
  },
  {
    name: "collab_responses.portfolio_url",
    read: () =>
      db
        .select({ id: collabResponses.id, value: collabResponses.portfolioUrl })
        .from(collabResponses)
        .where(isNotNull(collabResponses.portfolioUrl)),
    clear: (id: string | number) =>
      db
        .update(collabResponses)
        .set({ portfolioUrl: null })
        .where(eq(collabResponses.id, Number(id))),
  },
  {
    name: "developer_profiles.github_url",
    read: () =>
      db
        .select({ id: developerProfiles.id, value: developerProfiles.githubUrl })
        .from(developerProfiles)
        .where(isNotNull(developerProfiles.githubUrl)),
    clear: (id: string | number) =>
      db
        .update(developerProfiles)
        .set({ githubUrl: null })
        .where(eq(developerProfiles.id, String(id))),
  },
  {
    name: "developer_profiles.twitter_url",
    read: () =>
      db
        .select({ id: developerProfiles.id, value: developerProfiles.twitterUrl })
        .from(developerProfiles)
        .where(isNotNull(developerProfiles.twitterUrl)),
    clear: (id: string | number) =>
      db
        .update(developerProfiles)
        .set({ twitterUrl: null })
        .where(eq(developerProfiles.id, String(id))),
  },
  {
    name: "developer_profiles.website_url",
    read: () =>
      db
        .select({ id: developerProfiles.id, value: developerProfiles.websiteUrl })
        .from(developerProfiles)
        .where(isNotNull(developerProfiles.websiteUrl)),
    clear: (id: string | number) =>
      db
        .update(developerProfiles)
        .set({ websiteUrl: null })
        .where(eq(developerProfiles.id, String(id))),
  },
];

async function sweepTextColumns() {
  for (const { name, read, clear } of TEXT_COLUMNS) {
    const rows = await read();
    const unsafe = rows.filter((row) => row.value && !isExternalUrl(row.value));
    console.log(`${name}: ${rows.length} set, ${unsafe.length} unsafe`);
    for (const row of unsafe) {
      console.log(`  ${row.id}  ${row.value}`);
      if (DRY_RUN) continue;
      await clear(row.id);
    }
  }
}

async function sweepProjectLinks() {
  const rows = await db
    .select({ id: projects.id, links: projects.links })
    .from(projects)
    .where(sql`jsonb_array_length(${projects.links}) > 0`);
  let touched = 0;
  for (const row of rows) {
    const kept = row.links.filter((link) => isExternalUrl(link.url));
    if (kept.length === row.links.length) continue;
    touched++;
    for (const link of row.links.filter((link) => !isExternalUrl(link.url))) {
      console.log(`  ${row.id}  ${link.label}  ${link.url}`);
    }
    if (DRY_RUN) continue;
    await db.update(projects).set({ links: kept }).where(eq(projects.id, row.id));
  }
  console.log(`projects.links: ${rows.length} with links, ${touched} carrying unsafe entries`);
}

await sweepTextColumns();
await sweepProjectLinks();
process.exit(0);

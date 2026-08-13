import { os } from "@orpc/server";
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import {
  collabPosts,
  developerProfiles,
  profileProjects,
  profileUrlStubs,
  skills,
  teamMembers,
  teams,
  userSkills,
} from "@/db/schema";

/**
 * The member directory behind `/members`. Distinct from
 * `listAvailableUsers`, which is the for-hire slice — that one answers
 * "who can I hire right now", this one answers "who is here". Everyone
 * with a profile is listed; the default ordering is what keeps the
 * never-filled-in ones from leading, rather than a hidden filter that
 * would make the count a lie.
 */

/**
 * How long something you did still counts as something you're *doing*.
 * Entries inside this window are counted twice — see {@link activityScore}.
 */
const ACTIVE_WINDOW_DAYS = 180;

/** Skill chips a card shows before it stops counting. */
const CARD_SKILLS = 6;

/**
 * The score's alias. Needed as a real one: the ordering references it so
 * the subqueries below are evaluated once per row rather than again for
 * the sort, and Postgres will only resolve an output name it can see.
 */
const SCORE_ALIAS = "activity_score";

// Interpolated rather than parameterized: it's a module constant, and an
// untyped `$1 * interval '1 day'` leaves Postgres guessing the parameter's
// type. Every numeric weight below is inline for the same reason.
const RECENT_CUTOFF = sql.raw(`(now() - interval '${ACTIVE_WINDOW_DAYS} days')`);

/** Only work the public can actually open counts as a ship. */
const VISIBLE_SHIP = sql`${profileProjects.status} = 'approved'
  and ${profileProjects.published} = true
  and ${profileProjects.restrictedAt} is null
  and ${profileProjects.missingSince} is null`;

/** Provider publish date where there is one, else when the row landed. */
const SHIPPED_AT = sql`coalesce(
  ${profileProjects.publishedAt},
  ${profileProjects.participatedAt},
  ${profileProjects.createdAt}
)`;

const shipsTotal = sql<number>`(
  select count(*)::int from ${profileProjects}
  where ${profileProjects.profileId} = ${developerProfiles.id} and ${VISIBLE_SHIP}
)`;
const shipsRecent = sql<number>`(
  select count(*)::int from ${profileProjects}
  where ${profileProjects.profileId} = ${developerProfiles.id} and ${VISIBLE_SHIP}
    and ${SHIPPED_AT} >= ${RECENT_CUTOFF}
)`;

const teamsTotal = sql<number>`(
  select count(*)::int from ${teamMembers}
  join ${teams} on ${teams.id} = ${teamMembers.teamId} and ${teams.status} = 'active'
  where ${teamMembers.userId} = ${developerProfiles.id}
)`;
const teamsRecent = sql<number>`(
  select count(*)::int from ${teamMembers}
  join ${teams} on ${teams.id} = ${teamMembers.teamId} and ${teams.status} = 'active'
  where ${teamMembers.userId} = ${developerProfiles.id}
    and ${teamMembers.joinedAt} >= ${RECENT_CUTOFF}
)`;

const postsTotal = sql<number>`(
  select count(*)::int from ${collabPosts}
  where ${collabPosts.authorId} = ${developerProfiles.id}
)`;
const postsRecent = sql<number>`(
  select count(*)::int from ${collabPosts}
  where ${collabPosts.authorId} = ${developerProfiles.id}
    and ${collabPosts.createdAt} >= ${RECENT_CUTOFF}
)`;

/**
 * "Active" is what a member has actually put into the community,
 * counted twice if they did it recently:
 *
 *     score = 3·ships + 2·teams joined + 1·collab posts
 *           + the same again for whatever falls inside the last 180 days
 *
 * Shipping leads because it is the hardest thing to fake and the thing
 * the directory exists to surface; joining a crew is next; posting is a
 * real signal but a cheap one. Doubling the recent window rather than
 * filtering to it means a long-standing member never vanishes from the
 * rail, while someone who shipped last month outranks someone with the
 * same lifetime total who last shipped three years ago.
 */
const activityScore = sql<number>`(
  3 * (${shipsTotal} + ${shipsRecent})
  + 2 * (${teamsTotal} + ${teamsRecent})
  + 1 * (${postsTotal} + ${postsRecent})
)`;

/**
 * Drizzle drops table qualification from a `SQL` used *directly* as a
 * select field — the correlated subqueries above then read
 * `where "profile_id" = "id"`, which silently resolves against the inner
 * table and counts nothing. Nesting the fragment one level restores it,
 * so every count goes through here on its way into a select list.
 */
function selectable<T>(expr: SQL<T>): SQL<T> {
  return sql<T>`${expr}`;
}

/**
 * Hourly is the only rate that compares across people — a $2K fixed fee
 * and a $40/hr rate are not points on one scale — so the rate sort and
 * the rate ceiling both read hourly alone and let everyone else sink.
 */
const HOURLY_RATE = sql`case when ${developerProfiles.rateType} = 'hourly'
  then ${developerProfiles.rateMin} end`;

function escapeLike(str: string): string {
  return str.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export const MEMBER_AVAILABILITY = ["full_time", "part_time", "limited"] as const;
export const MEMBER_SORTS = ["active", "newest", "rate"] as const;

export const listMembers = os
  .route({ method: "GET" })
  .input(
    z.object({
      search: z.string().trim().max(100).optional(),
      skillIds: z.array(z.number().int().positive()).optional(),
      /** Any of these commitment levels — an OR, not a narrowing chain. */
      availability: z.array(z.enum(MEMBER_AVAILABILITY)).optional(),
      /** The profile's own "open to work" flag. */
      openToWork: z.boolean().optional(),
      /** Hourly ceiling in whole dollars. Implies "has an hourly rate". */
      maxHourlyRate: z.number().int().positive().optional(),
      sort: z.enum(MEMBER_SORTS).default("active"),
      limit: z.number().min(1).max(50).default(24),
      offset: z.number().min(0).default(0),
    }),
  )
  .handler(async ({ input }) => {
    const conditions = [];

    if (input.search) {
      const pattern = `%${escapeLike(input.search)}%`;
      conditions.push(
        or(
          ilike(developerProfiles.discordUsername, pattern),
          ilike(developerProfiles.guildNickname, pattern),
          ilike(developerProfiles.tagline, pattern),
          ilike(developerProfiles.lookingFor, pattern),
        )!,
      );
    }

    // Same `exists` shape the team directory uses for its derived stack,
    // so "who knows Godot" reads the same on both boards.
    if (input.skillIds && input.skillIds.length > 0) {
      conditions.push(
        sql`exists (
          select 1 from ${userSkills}
          where ${userSkills.userId} = ${developerProfiles.id}
            and ${inArray(userSkills.skillId, input.skillIds)}
        )`,
      );
    }

    if (input.openToWork) conditions.push(eq(developerProfiles.availableForWork, true));

    if (input.availability && input.availability.length > 0) {
      conditions.push(inArray(developerProfiles.availability, [...input.availability]));
    }

    if (input.maxHourlyRate != null) {
      conditions.push(sql`${HOURLY_RATE} is not null and ${HOURLY_RATE} <= ${input.maxHourlyRate}`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Ordered on the select-list alias so Postgres evaluates the score's
    // subqueries once per row rather than again for the sort. `id` is the
    // final tiebreak: without it a page boundary can drop or repeat a
    // member across two fetches of an otherwise tied ordering.
    const orderBy =
      input.sort === "newest"
        ? [desc(developerProfiles.createdAt), asc(developerProfiles.id)]
        : input.sort === "rate"
          ? [sql`${HOURLY_RATE} asc nulls last`, asc(developerProfiles.id)]
          : [
              sql.raw(`"${SCORE_ALIAS}" desc`),
              desc(developerProfiles.updatedAt),
              asc(developerProfiles.id),
            ];

    const [rows, [totals]] = await Promise.all([
      db
        .select({
          id: developerProfiles.id,
          discordUsername: developerProfiles.discordUsername,
          guildNickname: developerProfiles.guildNickname,
          avatarUrl: developerProfiles.avatarUrl,
          tagline: developerProfiles.tagline,
          lookingFor: developerProfiles.lookingFor,
          availableForWork: developerProfiles.availableForWork,
          availability: developerProfiles.availability,
          collabPreference: developerProfiles.collabPreference,
          rateType: developerProfiles.rateType,
          rateMin: developerProfiles.rateMin,
          rateMax: developerProfiles.rateMax,
          createdAt: developerProfiles.createdAt,
          shipCount: selectable(shipsTotal),
          teamCount: selectable(teamsTotal),
          postCount: selectable(postsTotal),
          activityScore: selectable(activityScore).as(SCORE_ALIAS),
        })
        .from(developerProfiles)
        .where(where)
        .orderBy(...orderBy)
        .limit(input.limit)
        .offset(input.offset),
      db.select({ count: count() }).from(developerProfiles).where(where),
    ]);

    return { members: await withMemberCardExtras(rows), total: totals?.count ?? 0 };
  });

/**
 * The two per-member lists a card needs — the stack and the vanity stub
 * its link prefers — as two queries keyed on the page's ids rather than
 * two per row. Same no-N+1 shape as the team directory's card extras.
 */
async function withMemberCardExtras<T extends { id: string }>(rows: T[]) {
  const userIds = rows.map((r) => r.id);
  if (userIds.length === 0) return [];

  const [stubRows, skillRows] = await Promise.all([
    db
      .select({ profileId: profileUrlStubs.profileId, stub: profileUrlStubs.stub })
      .from(profileUrlStubs)
      .where(inArray(profileUrlStubs.profileId, userIds)),
    db
      .select({ userId: userSkills.userId, id: skills.id, name: skills.name })
      .from(userSkills)
      .innerJoin(skills, eq(userSkills.skillId, skills.id))
      .where(inArray(userSkills.userId, userIds))
      .orderBy(asc(skills.name)),
  ]);

  const stubByUser = new Map(stubRows.map((r) => [r.profileId, r.stub]));
  const skillsByUser = new Map<string, { id: number; name: string }[]>();
  for (const row of skillRows) {
    const list = skillsByUser.get(row.userId) ?? [];
    list.push({ id: row.id, name: row.name });
    skillsByUser.set(row.userId, list);
  }

  return rows.map((row) => {
    const stack = skillsByUser.get(row.id) ?? [];
    return {
      ...row,
      urlStub: stubByUser.get(row.id) ?? null,
      skills: stack.slice(0, CARD_SKILLS),
      // The card says "+3" rather than dropping them silently.
      hiddenSkillCount: Math.max(0, stack.length - CARD_SKILLS),
    };
  });
}

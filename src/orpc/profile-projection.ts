import { eq, ilike, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { developerProfiles, profileUrlStubs } from "@/db/schema";
import { adminUserOverrides } from "@/lib/discord";

/**
 * `developer_profiles.guildRoles` with the override names folded in, for
 * any byline that renders a rank chip.
 *
 * The column itself is a faithful mirror of Discord and stays that way —
 * `lib/staff-roles` explains why the override is never written to it. But
 * a chip read straight off the mirror shows an override holder whatever
 * guild role they happen to carry, so the same union `applyRoleOverrides`
 * does in TypeScript is done here in SQL, where a byline query has the
 * discord id in hand but no row objects to post-process.
 *
 * The id list is read when the projection is built — import time for the
 * shared columns below — so a change to `ADMIN_DISCORD_IDS` lands on the
 * next boot, which is how Railway applies a variable change anyway. An
 * empty list short circuits back to the plain column.
 */
export function bylineGuildRoles(): SQL<string[] | null> | typeof developerProfiles.guildRoles {
  const ids = [...adminUserOverrides()];
  if (ids.length === 0) return developerProfiles.guildRoles;
  // Each id bound on its own rather than one array parameter, so nothing
  // depends on how the driver serialises a JS array into `text[]`. The
  // `coalesce` matters: in Postgres `null || array` is null, which would
  // blank the chip for an override holder who has never synced a role.
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql<string[] | null>`case
      when ${developerProfiles.discordId} in (${list})
      then coalesce(${developerProfiles.guildRoles}, '{}'::text[]) || '{Admin,Dev}'::text[]
      else ${developerProfiles.guildRoles}
    end`;
}

/**
 * The profile-identity projection a byline needs, in one place instead of a
 * hand-rolled copy per query. Spread into a `.select({ ... })` and pair with
 * `.leftJoin(profileUrlStubs, profileStubJoin)` — left join, because a row
 * without a vanity stub still renders (`profileSlug` falls back to the id).
 */
export const profileIdentityColumns = {
  discordUsername: developerProfiles.discordUsername,
  guildNickname: developerProfiles.guildNickname,
  avatarUrl: developerProfiles.avatarUrl,
  guildAvatarUrl: developerProfiles.guildAvatarUrl,
  // Feeds the rank badge (`guildRankOf`) beside the name; already public
  // through `getProfile`, so nothing new leaks by riding every byline.
  guildRoles: bylineGuildRoles(),
  urlStub: profileUrlStubs.stub,
};

/**
 * Jam community surfaces render the guild nickname as `username` (the jam
 * roster predates the nickname/username split); same columns, jam's aliases.
 */
export const jamMemberIdentityColumns = {
  username: developerProfiles.guildNickname,
  discordUsername: developerProfiles.discordUsername,
  avatarUrl: developerProfiles.avatarUrl,
  guildAvatarUrl: developerProfiles.guildAvatarUrl,
  urlStub: profileUrlStubs.stub,
};

/** The join condition the `urlStub` column above depends on. */
export const profileStubJoin = eq(profileUrlStubs.profileId, developerProfiles.id);

/**
 * "Search members by name" — one definition of which columns count as a
 * name. Four hand-rolled variants disagreed (one omitted `guildNickname`,
 * so searching a member's display name found nothing). `pattern` is a
 * ready `ILIKE` pattern (see `likeContains`); surfaces `or(...)` their own
 * extra columns (tagline, skills) around this.
 *
 * Both Discord names count, because `discordUsername` is the display name
 * and `discordHandle` is the @handle. The vanity stub counts too: it is
 * the only identity a member reads off their own profile URL, and for
 * anyone who has not signed in since `discordHandle` existed it is the
 * sole surviving copy of their handle. Matched via `exists` rather than a
 * join, since no caller joins `profile_url_stubs` in its filtered query.
 */
export function profileNameSearch(pattern: string): SQL {
  return or(
    ilike(developerProfiles.guildNickname, pattern),
    ilike(developerProfiles.discordUsername, pattern),
    ilike(developerProfiles.discordHandle, pattern),
    sql`exists (
      select 1 from ${profileUrlStubs}
      where ${profileUrlStubs.profileId} = ${developerProfiles.id}
        and ${profileUrlStubs.stub} ilike ${pattern}
    )`,
  )!;
}

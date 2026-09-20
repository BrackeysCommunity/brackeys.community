import { eq, ilike, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { developerProfiles, profileUrlStubs } from "@/db/schema";

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
  guildRoles: developerProfiles.guildRoles,
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

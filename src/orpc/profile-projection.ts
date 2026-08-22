import { eq, ilike, or } from "drizzle-orm";
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
 */
export function profileNameSearch(pattern: string): SQL {
  return or(
    ilike(developerProfiles.guildNickname, pattern),
    ilike(developerProfiles.discordUsername, pattern),
  )!;
}

/**
 * The house display-name rule: the guild nickname if they have set one, else
 * their Discord handle. It reads `||` rather than `??` on purpose — an empty
 * nickname is no nickname.
 *
 * The fallback is the caller's, because the surface decides how a nameless row
 * should read: a list says "Member", a sentence says "a member", and the audit
 * log would rather store null than a placeholder.
 *
 * This is the *guild* reading. Whether a viewer gets it is a separate
 * question, answered by `memberDisplayName` below; call this directly only
 * where the viewer is known to be in the guild (staff surfaces, the audit
 * log, the Discord bot) or where no viewer exists and the guild reading is
 * wanted regardless.
 */
export type MemberNameFields = {
  guildNickname?: string | null;
  discordUsername?: string | null;
};

export function memberName(fields: MemberNameFields): string | null;
export function memberName<F>(fields: MemberNameFields, fallback: F): string | F;
export function memberName(fields: MemberNameFields, fallback: unknown = null): unknown {
  return fields.guildNickname?.trim() || fields.discordUsername?.trim() || fallback;
}

/**
 * Who is looking. A member has two faces — the one the guild knows (nickname,
 * server avatar) and the one Discord shows everyone else (handle, global
 * avatar) — and the site shows the guild face only to people who are in the
 * guild themselves, so that reaching someone here and then DMing them on
 * Discord shows the same person twice. Anonymous readers, members outside
 * the guild, crawlers and OG cards all get the global face.
 */
export type MemberViewer = { inGuild: boolean };

/** No viewer, or one the site knows nothing about: the global face. */
export const ANON_VIEWER: MemberViewer = { inGuild: false };

export type MemberIdentityFields = MemberNameFields & {
  avatarUrl?: string | null;
  guildAvatarUrl?: string | null;
};

export function memberDisplayName(fields: MemberNameFields, viewer: MemberViewer): string | null;
export function memberDisplayName<F>(
  fields: MemberNameFields,
  viewer: MemberViewer,
  fallback: F,
): string | F;
export function memberDisplayName(
  fields: MemberNameFields,
  viewer: MemberViewer,
  fallback: unknown = null,
): unknown {
  if (viewer.inGuild) return memberName(fields, fallback);
  return fields.discordUsername?.trim() || fallback;
}

export function memberAvatarUrl(
  fields: Pick<MemberIdentityFields, "avatarUrl" | "guildAvatarUrl">,
  viewer: MemberViewer,
): string | null {
  if (viewer.inGuild && fields.guildAvatarUrl) return fields.guildAvatarUrl;
  return fields.avatarUrl ?? null;
}

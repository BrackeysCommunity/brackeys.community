/**
 * The house display-name rule: the guild nickname if they have set one, else
 * their Discord handle. It reads `||` rather than `??` on purpose — an empty
 * nickname is no nickname.
 *
 * The fallback is the caller's, because the surface decides how a nameless row
 * should read: a list says "Member", a sentence says "a member", and the audit
 * log would rather store null than a placeholder.
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

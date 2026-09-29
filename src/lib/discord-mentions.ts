/**
 * Discord user and role mentions in text, `<@id>` (or the legacy `<@!id>`)
 * and `<@&id>`. They arrive in macros and in text written in Discord; the
 * site's own mentions are `@handle`. Pure and client-safe.
 */

export const USER_TOKEN_PATTERN = /<@!?(\d{17,20})>/g;
export const ROLE_TOKEN_PATTERN = /<@&(\d{17,20})>/g;
/** Either kind, so one pass keeps them in order: group 1 is `&` for a role. */
export const DISCORD_MENTION_PATTERN = /<@([!&]?)(\d{17,20})>/g;

export interface GuildRole {
  id: string;
  name: string;
  /** `0` means the role has no color. */
  color: number;
}

export interface DiscordUserName {
  discordId: string;
  /** Set when they have a profile on the site. */
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
}

/** `<@id>` → `@user`, `<@&id>` → `@role`, for plain-text surfaces. */
export function discordMentionsToNames(text: string): string {
  return text.replace(ROLE_TOKEN_PATTERN, "@role").replace(USER_TOKEN_PATTERN, "@user");
}

/** A role color as CSS, or null for an uncolored role. */
export function roleColor(color: number): string | null {
  return color ? `#${color.toString(16).padStart(6, "0")}` : null;
}

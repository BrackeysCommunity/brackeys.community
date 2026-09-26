/**
 * Guild channel mentions in text. Bodies and macros store Discord's own
 * token, `<#id>`, so the Discord mirrors post it untouched and a renamed
 * channel keeps rendering. Pure and client-safe.
 */

export interface GuildChannel {
  id: string;
  name: string;
}

export interface GuildChannels {
  guildId: string;
  channels: GuildChannel[];
}

export const CHANNEL_TOKEN_PATTERN = /<#(\d{17,20})>/g;

/** `<#id>` → `#channel`, for plain-text surfaces that can't look the name up. */
export function channelTokensToNames(text: string): string {
  return text.replace(CHANNEL_TOKEN_PATTERN, "#channel");
}

export interface DiscordApiChannel {
  id: string;
  name?: string | null;
  type: number;
  permission_overwrites?: { id: string; type: number; allow: string; deny: string }[];
}

const VIEW_CHANNEL = 1n << 10n;
const ADMINISTRATOR = 1n << 3n;

/** Text, voice, announcement, stage, forum and media channels; not categories. */
const LISTED_TYPES = new Set([0, 2, 5, 13, 15, 16]);

/**
 * The channels `@everyone` can view. Discord computes a channel's access
 * from the guild's `@everyone` role and the channel's own overwrites (a
 * category only copies its overwrites onto channels synced to it), so
 * staff-only channels drop out here and their names never leave the server.
 */
export function publicChannels(
  guildId: string,
  everyonePermissions: string,
  raw: DiscordApiChannel[],
): GuildChannel[] {
  const base = BigInt(everyonePermissions);
  const admin = (base & ADMINISTRATOR) !== 0n;
  return raw
    .filter((channel): channel is DiscordApiChannel & { name: string } => {
      if (!channel.name || !LISTED_TYPES.has(channel.type)) return false;
      if (admin) return true;
      let perms = base;
      const everyone = channel.permission_overwrites?.find((o) => o.id === guildId);
      if (everyone) perms = (perms & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
      return (perms & VIEW_CHANNEL) !== 0n;
    })
    .map((channel) => ({ id: channel.id, name: channel.name }));
}

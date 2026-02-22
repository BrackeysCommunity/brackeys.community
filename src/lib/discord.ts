export interface DiscordGuildMember {
  avatar: string | null
  nick: string | null
  roles: string[]
  joined_at: string
  bio: string | null
  pending: boolean
  flags: number
}

// Hardcoded role ID → display name map.
// Update these when guild roles change.
const GUILD_ROLE_NAMES: Record<string, string> = {
  // Example: '123456789012345678': 'Moderator',
}

/** Resolve an array of role IDs to their display names, dropping unknown IDs. */
export function resolveRoleNames(roleIds: string[]): string[] {
  return roleIds
    .map((id) => GUILD_ROLE_NAMES[id])
    .filter((name): name is string => name != null)
}

export async function fetchGuildMember(
  accessToken: string,
): Promise<DiscordGuildMember> {
  const guildId = process.env.DISCORD_GUILD_ID!
  const response = await fetch(
    `https://discord.com/api/users/@me/guilds/${guildId}/member`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch guild member: ${response.status}`)
  }

  return response.json() as Promise<DiscordGuildMember>
}

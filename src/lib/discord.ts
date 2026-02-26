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
  '451380371284557824': 'Admin',
  '756285704061059213': 'Staff',
  '756178968901582859': 'Moderator',
}

/** Resolve an array of role IDs to their display names, dropping unknown IDs. */
export function resolveRoleNames(roleIds: string[]): string[] {
  return roleIds
    .map((id) => GUILD_ROLE_NAMES[id])
    .filter((name): name is string => name != null)
}

/** Check if guild roles contain a specific role name. */
export function hasRole(guildRoles: string[] | null, roleName: string): boolean {
  if (!guildRoles) return false
  return guildRoles.includes(roleName)
}

/** Check if the user is a staff member (Staff, Moderator, or Admin). */
export function isStaffMember(guildRoles: string[] | null): boolean {
  if (!guildRoles) return false
  return guildRoles.some((role) => role === 'Admin' || role === 'Staff' || role === 'Moderator')
}

/** Check if the user is an Admin. */
export function isAdmin(guildRoles: string[] | null): boolean {
  return hasRole(guildRoles, 'Admin')
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

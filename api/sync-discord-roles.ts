import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clerkClient } from '@clerk/clerk-sdk-node';

const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

// Discord role IDs
const DISCORD_ROLES = {
  admin: '451380371284557824',
  staff: '756285704061059213',
  moderator: '756178968901582859',
  brackeys: '491536338525356042',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Simple CORS setup - allow all origins for this public API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    console.log(`Manually syncing Discord roles for user: ${userId}`);

    // Get the Discord OAuth access token from Clerk
    const tokenResponse = await clerkClient.users.getUserOauthAccessToken(userId, 'oauth_discord');
    const accessToken = tokenResponse.data[0]?.token;

    if (!accessToken) {
      console.warn(`No Discord access token found for user: ${userId}`);
      return res.status(401).json({ error: 'No Discord access token found' });
    }

    // Fetch Discord guild member data
    const discordResponse = await fetch(
      `https://discord.com/api/v10/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!discordResponse.ok) {
      const errorText = await discordResponse.text();
      console.error('Discord API error:', errorText);

      if (discordResponse.status === 404) {
        console.log(`User ${userId} is not a member of guild ${DISCORD_GUILD_ID}`);
        // Update metadata to indicate they're not in the guild
        await clerkClient.users.updateUserMetadata(userId, {
          publicMetadata: {
            hasura: {
              defaultRole: 'user',
              allowedRoles: ['user'],
            },
            discord: {
              inGuild: false,
            },
          },
        });
        return res.status(200).json({
          success: true,
          notInGuild: true,
          message: 'User is not a member of the Discord guild' + DISCORD_GUILD_ID,
        });
      }

      return res.status(discordResponse.status).json({
        error: 'Failed to fetch Discord member data',
        details: errorText,
      });
    }

    const memberData = await discordResponse.json();

    // Determine user roles based on Discord roles
    const userRoles = memberData.roles || [];
    const hasuraRoles = ['user'];

    if (userRoles.includes(DISCORD_ROLES.admin)) hasuraRoles.push('admin');
    if (userRoles.includes(DISCORD_ROLES.staff)) hasuraRoles.push('staff');
    if (userRoles.includes(DISCORD_ROLES.moderator)) hasuraRoles.push('moderator');
    if (userRoles.includes(DISCORD_ROLES.brackeys)) hasuraRoles.push('brackeys');

    // Determine default role (highest privilege)
    const defaultRole = hasuraRoles.includes('admin')
      ? 'admin'
      : hasuraRoles.includes('staff')
        ? 'staff'
        : hasuraRoles.includes('moderator')
          ? 'moderator'
          : hasuraRoles.includes('brackeys')
            ? 'brackeys'
            : 'user';

    // Update Clerk user metadata
    await clerkClient.users.updateUserMetadata(userId, {
      publicMetadata: {
        hasura: {
          defaultRole,
          allowedRoles: hasuraRoles,
        },
        discord: {
          inGuild: true,
          avatar: memberData.avatar,
          roles: memberData.roles,
          nick: memberData.nick,
          joined_at: memberData.joined_at,
          premium_since: memberData.premium_since,
        },
      },
    });

    return res.status(200).json({
      success: true,
      roles: hasuraRoles,
      defaultRole,
      memberData: {
        avatar: memberData.avatar,
        nick: memberData.nick,
        roles: memberData.roles,
        joined_at: memberData.joined_at,
      },
    });
  } catch (error) {
    console.error('Error syncing Discord roles:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

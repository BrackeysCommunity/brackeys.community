import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Webhook } from 'svix';
import { clerkClient } from '@clerk/clerk-sdk-node';

const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

// Discord role IDs
const DISCORD_ROLES = {
  admin: '451380371284557824',
  staff: '756285704061059213',
  moderator: '756178968901582859',
  brackeys: '491536338525356042',
};

async function syncDiscordRoles(userId: string) {
  try {
    console.log(`Syncing Discord roles for user: ${userId}`);

    // Get the Discord OAuth access token from Clerk
    const tokenResponse = await clerkClient.users.getUserOauthAccessToken(userId, 'oauth_discord');
    const accessToken = tokenResponse.data[0]?.token;

    if (!accessToken) {
      console.warn(`No Discord access token found for user: ${userId}`);
      return { success: false, error: 'No Discord token' };
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
        return { success: true, notInGuild: true };
      }

      return { success: false, error: `Discord API error: ${discordResponse.status}` };
    }

    const memberData = await discordResponse.json();
    console.log('Discord member data:', {
      userId,
      roles: memberData.roles,
      nick: memberData.nick,
    });

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

    console.log(`Successfully synced Discord roles for user ${userId}:`, {
      defaultRole,
      allowedRoles: hasuraRoles,
    });

    return {
      success: true,
      roles: hasuraRoles,
      defaultRole,
    };
  } catch (error) {
    console.error('Error syncing Discord roles:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers - allow localhost and production domains
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4173',
    'https://brackeys.dev',
    'https://www.brackeys.dev',
    'https://brackeys-web.vercel.app',
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
  ].filter(Boolean);

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    // For webhooks from Clerk (no origin), allow all
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, svix-id, svix-timestamp, svix-signature'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!CLERK_WEBHOOK_SECRET) {
    console.error('CLERK_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Get the headers
  const svix_id = req.headers['svix-id'] as string;
  const svix_timestamp = req.headers['svix-timestamp'] as string;
  const svix_signature = req.headers['svix-signature'] as string;

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return res.status(400).json({ error: 'Missing svix headers' });
  }

  const payload = req.body;
  const body = JSON.stringify(payload);

  // Verify the webhook
  const wh = new Webhook(CLERK_WEBHOOK_SECRET);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let evt: any;

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    });
  } catch (err) {
    console.error('Error verifying webhook:', err);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const eventType = evt.type;
  console.log(`Received Clerk webhook: ${eventType}`, {
    type: eventType,
    userId: evt.data.user_id || evt.data.id,
  });

  // Handle different event types
  // Sync on user creation and every session creation to re-evaluate Discord roles
  if (eventType === 'user.created' || eventType === 'session.created') {
    const userId = evt.data.user_id || evt.data.id;

    if (!userId) {
      console.error('No user ID found in webhook event');
      return res.status(400).json({ error: 'No user ID in event' });
    }

    console.log(`Syncing Discord roles for user ${userId} (event: ${eventType})`);

    // Sync Discord roles
    const result = await syncDiscordRoles(userId);

    if (result.success) {
      if (result.notInGuild) {
        console.log(`User ${userId} is not in the Discord guild`);
      } else {
        console.log(`Discord roles synced successfully for user ${userId}:`, {
          defaultRole: result.defaultRole,
          roles: result.roles,
        });
      }
    } else {
      console.error(`Failed to sync Discord roles for user ${userId}:`, result.error);
      // Don't fail the webhook, just log the error
    }
  }

  return res.status(200).json({ received: true });
}

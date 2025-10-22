import { clerkClient } from '@clerk/clerk-sdk-node';
import * as Sentry from '@sentry/tanstackstart-react';
import { createFileRoute } from '@tanstack/react-router';
import { json } from '@tanstack/react-start';

const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

// Discord role IDs
const DISCORD_ROLES = {
  admin: '451380371284557824',
  staff: '756285704061059213',
  moderator: '756178968901582859',
  brackeys: '491536338525356042',
};

export const Route = createFileRoute('/api/auth/sync-discord')({
  component: () => null, // Prevent page rendering
  server: {
    handlers: {
      OPTIONS: async () => {
        // Handle CORS preflight
        return new Response(null, {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      },
      POST: async ({ request }) => {
        return await Sentry.startSpan(
          { name: 'Manual Discord Sync' },
          async () => {
            try {
              console.log('\n\n' + '▓'.repeat(100));
              console.log('🔄 MANUAL DISCORD SYNC REQUEST');
              console.log('▓'.repeat(100));
              console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
              console.log(
                `🌐 Origin: ${request.headers.get('origin') || 'N/A'}`,
              );
              console.log(
                `📍 User-Agent: ${request.headers.get('user-agent') || 'N/A'}`,
              );

              const body = await request.json();
              const { userId } = body as { userId?: string };

              console.log(`📝 [MANUAL SYNC] Request body:`, body);

              if (!userId) {
                console.error(
                  '❌ [MANUAL SYNC] Missing userId in request body!',
                );
                console.log('▓'.repeat(100) + '\n\n');
                return json({ error: 'Missing userId' }, { status: 400 });
              }

              console.log(
                `🎯 [MANUAL SYNC] Starting manual Discord role sync for user: ${userId}`,
              );

              // Get the Discord OAuth access token from Clerk
              console.log(
                `📡 [MANUAL SYNC] Fetching Discord OAuth token from Clerk...`,
              );
              const tokenResponse =
                await clerkClient.users.getUserOauthAccessToken(
                  userId,
                  'oauth_discord',
                );
              const accessToken = tokenResponse.data[0]?.token;

              if (!accessToken) {
                console.warn(
                  `⚠️  [MANUAL SYNC] No Discord access token found for user: ${userId}`,
                );
                console.log(
                  `   Available OAuth providers: ${tokenResponse.data.map((t) => t.provider).join(', ') || 'none'}`,
                );
                console.log('▓'.repeat(100) + '\n\n');
                return json(
                  { error: 'No Discord access token found' },
                  { status: 401 },
                );
              }

              console.log(
                `✅ [MANUAL SYNC] Discord token retrieved successfully`,
              );

              // Fetch Discord guild member data
              console.log(
                `📡 [MANUAL SYNC] Fetching Discord guild member data for guild: ${DISCORD_GUILD_ID}...`,
              );
              const discordResponse = await fetch(
                `https://discord.com/api/v10/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                },
              );

              if (!discordResponse.ok) {
                const errorText = await discordResponse.text();
                console.error(
                  `❌ [MANUAL SYNC] Discord API error (${discordResponse.status}):`,
                  errorText,
                );

                if (discordResponse.status === 404) {
                  console.log(
                    `ℹ️  [MANUAL SYNC] User ${userId} is not a member of guild ${DISCORD_GUILD_ID}`,
                  );
                  console.log(
                    `📝 [MANUAL SYNC] Updating user metadata to reflect non-guild status...`,
                  );

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

                  console.log(
                    `✅ [MANUAL SYNC] Metadata updated for non-guild user`,
                  );
                  console.log('▓'.repeat(100) + '\n\n');

                  return json({
                    success: true,
                    notInGuild: true,
                    message: `User is not a member of the Discord guild ${DISCORD_GUILD_ID}`,
                  });
                }

                console.log('▓'.repeat(100) + '\n\n');
                return json(
                  {
                    error: 'Failed to fetch Discord member data',
                    details: errorText,
                  },
                  { status: discordResponse.status },
                );
              }

              const memberData = await discordResponse.json();
              console.log(
                `✅ [MANUAL SYNC] Discord member data retrieved successfully`,
              );
              console.log(`   User: ${memberData.nick || 'No nickname'}`);
              console.log(`   User ID: ${memberData.user?.id || 'N/A'}`);
              console.log(
                `   Roles: ${(memberData.roles || []).length} role(s)`,
              );
              console.log(`   Joined: ${memberData.joined_at || 'Unknown'}`);
              console.log(
                `   Premium: ${memberData.premium_since ? 'Yes' : 'No'}`,
              );
              console.log(`   Avatar: ${memberData.avatar || 'Default'}`);

              // Determine user roles based on Discord roles
              const userRoles = memberData.roles || [];
              const hasuraRoles = ['user'];

              console.log(`🔍 [MANUAL SYNC] Analyzing Discord roles...`);
              console.log(`   Total Discord roles: ${userRoles.length}`);

              if (userRoles.includes(DISCORD_ROLES.admin)) {
                hasuraRoles.push('admin');
                console.log(
                  `   ✓ Admin role detected (${DISCORD_ROLES.admin})`,
                );
              }
              if (userRoles.includes(DISCORD_ROLES.staff)) {
                hasuraRoles.push('staff');
                console.log(
                  `   ✓ Staff role detected (${DISCORD_ROLES.staff})`,
                );
              }
              if (userRoles.includes(DISCORD_ROLES.moderator)) {
                hasuraRoles.push('moderator');
                console.log(
                  `   ✓ Moderator role detected (${DISCORD_ROLES.moderator})`,
                );
              }
              if (userRoles.includes(DISCORD_ROLES.brackeys)) {
                hasuraRoles.push('brackeys');
                console.log(
                  `   ✓ Brackeys role detected (${DISCORD_ROLES.brackeys})`,
                );
              }

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

              console.log(`📝 [MANUAL SYNC] Computed roles:`);
              console.log(`   Default: ${defaultRole}`);
              console.log(`   Allowed: ${hasuraRoles.join(', ')}`);

              // Update Clerk user metadata
              console.log(`📝 [MANUAL SYNC] Updating Clerk user metadata...`);
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

              console.log(
                `✅ [MANUAL SYNC] Successfully synced Discord roles for user ${userId}`,
              );
              console.log('▓'.repeat(100) + '\n\n');

              return json({
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
              console.error('\n\n' + '▓'.repeat(100));
              console.error(
                '❌ [MANUAL SYNC] Fatal error during manual Discord sync:',
              );
              console.error('▓'.repeat(100));
              console.error(error);
              console.error('▓'.repeat(100) + '\n\n');

              Sentry.captureException(error, {
                tags: { operation: 'manual-discord-sync' },
              });

              return json(
                {
                  error: 'Internal server error',
                  message:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                { status: 500 },
              );
            }
          },
        );
      },
    },
  },
});

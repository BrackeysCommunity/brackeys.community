import { clerkClient } from '@clerk/clerk-sdk-node';
import * as Sentry from '@sentry/tanstackstart-react';
import { createFileRoute } from '@tanstack/react-router';
import { json } from '@tanstack/react-start';
import { Webhook } from 'svix';

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
  return await Sentry.startSpan(
    { name: 'syncDiscordRoles', attributes: { userId } },
    async () => {
      try {
        console.log('\n' + '='.repeat(80));
        console.log(
          `🔄 [DISCORD SYNC] Starting Discord role sync for user: ${userId}`,
        );
        console.log('='.repeat(80));

        // Get the Discord OAuth access token from Clerk
        console.log(
          `📡 [DISCORD SYNC] Fetching Discord OAuth token from Clerk...`,
        );
        const tokenResponse = await clerkClient.users.getUserOauthAccessToken(
          userId,
          'oauth_discord',
        );
        const accessToken = tokenResponse.data[0]?.token;

        if (!accessToken) {
          console.warn(
            `⚠️  [DISCORD SYNC] No Discord access token found for user: ${userId}`,
          );
          console.log(
            `   Available providers: ${tokenResponse.data.map((t) => t.provider).join(', ') || 'none'}`,
          );
          console.log('='.repeat(80) + '\n');
          return { success: false, error: 'No Discord token' };
        }

        console.log(`✅ [DISCORD SYNC] Discord token retrieved successfully`);

        // Fetch Discord guild member data
        console.log(
          `📡 [DISCORD SYNC] Fetching Discord guild member data for guild: ${DISCORD_GUILD_ID}...`,
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
            `❌ [DISCORD SYNC] Discord API error (${discordResponse.status}):`,
            errorText,
          );

          if (discordResponse.status === 404) {
            console.log(
              `ℹ️  [DISCORD SYNC] User ${userId} is not a member of guild ${DISCORD_GUILD_ID}`,
            );
            console.log(
              `📝 [DISCORD SYNC] Updating user metadata to reflect non-guild status...`,
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
              `✅ [DISCORD SYNC] Metadata updated for non-guild user`,
            );
            console.log('='.repeat(80) + '\n');
            return { success: true, notInGuild: true };
          }

          console.log('='.repeat(80) + '\n');
          return {
            success: false,
            error: `Discord API error: ${discordResponse.status}`,
          };
        }

        const memberData = await discordResponse.json();
        console.log(
          `✅ [DISCORD SYNC] Discord member data retrieved successfully`,
        );
        console.log(`   User: ${memberData.nick || 'No nickname'}`);
        console.log(`   Roles: ${(memberData.roles || []).length} role(s)`);
        console.log(`   Joined: ${memberData.joined_at || 'Unknown'}`);
        console.log(`   Premium: ${memberData.premium_since ? 'Yes' : 'No'}`);

        // Determine user roles based on Discord roles
        const userRoles = memberData.roles || [];
        const hasuraRoles = ['user'];

        console.log(`🔍 [DISCORD SYNC] Analyzing Discord roles...`);
        if (userRoles.includes(DISCORD_ROLES.admin)) {
          hasuraRoles.push('admin');
          console.log(`   ✓ Admin role detected`);
        }
        if (userRoles.includes(DISCORD_ROLES.staff)) {
          hasuraRoles.push('staff');
          console.log(`   ✓ Staff role detected`);
        }
        if (userRoles.includes(DISCORD_ROLES.moderator)) {
          hasuraRoles.push('moderator');
          console.log(`   ✓ Moderator role detected`);
        }
        if (userRoles.includes(DISCORD_ROLES.brackeys)) {
          hasuraRoles.push('brackeys');
          console.log(`   ✓ Brackeys role detected`);
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

        console.log(`📝 [DISCORD SYNC] Computed roles:`);
        console.log(`   Default: ${defaultRole}`);
        console.log(`   Allowed: ${hasuraRoles.join(', ')}`);

        // Update Clerk user metadata
        console.log(`📝 [DISCORD SYNC] Updating Clerk user metadata...`);
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
          `✅ [DISCORD SYNC] Successfully synced Discord roles for user ${userId}`,
        );
        console.log('='.repeat(80) + '\n');

        return {
          success: true,
          roles: hasuraRoles,
          defaultRole,
        };
      } catch (error) {
        console.error('\n' + '='.repeat(80));
        console.error('❌ [DISCORD SYNC] Error syncing Discord roles:');
        console.error('='.repeat(80));
        console.error(error);
        console.error('='.repeat(80) + '\n');

        Sentry.captureException(error, {
          tags: { operation: 'discord-sync', userId },
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );
}

export const Route = createFileRoute('/api/webhooks/clerk')({
  component: () => null, // Prevent page rendering
  server: {
    handlers: {
      GET: async () => {
        return json({
          message: 'Clerk webhook endpoint. Use POST to send webhook events.',
          status: 'healthy',
        });
      },
      POST: async ({ request }) => {
        return await Sentry.startSpan(
          { name: 'Clerk Webhook Handler' },
          async () => {
            try {
              console.log('\n\n' + '█'.repeat(100));
              console.log('🔔 CLERK WEBHOOK RECEIVED');
              console.log('█'.repeat(100));
              console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
              console.log(
                `🌐 Origin: ${request.headers.get('origin') || 'N/A'}`,
              );
              console.log(
                `📍 User-Agent: ${request.headers.get('user-agent') || 'N/A'}`,
              );

              if (!CLERK_WEBHOOK_SECRET) {
                console.error('❌ [WEBHOOK] CLERK_WEBHOOK_SECRET is not set!');
                console.log('█'.repeat(100) + '\n\n');
                return json(
                  { error: 'Webhook secret not configured' },
                  { status: 500 },
                );
              }

              // Get the Svix headers
              const svix_id = request.headers.get('svix-id');
              const svix_timestamp = request.headers.get('svix-timestamp');
              const svix_signature = request.headers.get('svix-signature');

              console.log(`🔐 [WEBHOOK] Svix headers:`);
              console.log(`   ID: ${svix_id || 'MISSING'}`);
              console.log(`   Timestamp: ${svix_timestamp || 'MISSING'}`);
              console.log(
                `   Signature: ${svix_signature ? 'Present' : 'MISSING'}`,
              );

              if (!svix_id || !svix_timestamp || !svix_signature) {
                console.error('❌ [WEBHOOK] Missing Svix headers!');
                console.log('█'.repeat(100) + '\n\n');
                return json({ error: 'Missing svix headers' }, { status: 400 });
              }

              // Get the body
              const body = await request.text();
              console.log(`📦 [WEBHOOK] Raw body length: ${body.length} bytes`);

              // Verify the webhook
              console.log(`🔍 [WEBHOOK] Verifying webhook signature...`);
              const wh = new Webhook(CLERK_WEBHOOK_SECRET);
              let evt: any;

              try {
                evt = wh.verify(body, {
                  'svix-id': svix_id,
                  'svix-timestamp': svix_timestamp,
                  'svix-signature': svix_signature,
                });
                console.log(`✅ [WEBHOOK] Signature verified successfully`);
              } catch (err) {
                console.error(
                  '❌ [WEBHOOK] Error verifying webhook signature:',
                );
                console.error(err);
                console.log('█'.repeat(100) + '\n\n');
                Sentry.captureException(err, {
                  tags: { operation: 'webhook-verification' },
                });
                return json({ error: 'Invalid signature' }, { status: 400 });
              }

              const eventType = evt.type;
              const userId = evt.data.user_id || evt.data.id;

              console.log(`📋 [WEBHOOK] Event details:`);
              console.log(`   Type: ${eventType}`);
              console.log(`   User ID: ${userId || 'N/A'}`);
              console.log(
                `   Data keys: ${Object.keys(evt.data || {}).join(', ')}`,
              );
              console.log(`\n📄 [WEBHOOK] Full event payload:`);
              console.log(JSON.stringify(evt, null, 2));

              // Handle different event types
              if (
                eventType === 'user.created' ||
                eventType === 'session.created'
              ) {
                console.log(
                  `\n🎯 [WEBHOOK] Processing ${eventType} event for user ${userId}...`,
                );

                if (!userId) {
                  console.error('❌ [WEBHOOK] No user ID found in event!');
                  console.log('█'.repeat(100) + '\n\n');
                  return json(
                    { error: 'No user ID in event' },
                    { status: 400 },
                  );
                }

                // Sync Discord roles
                console.log(`🔄 [WEBHOOK] Initiating Discord role sync...`);
                const result = await syncDiscordRoles(userId);

                if (result.success) {
                  if (result.notInGuild) {
                    console.log(
                      `ℹ️  [WEBHOOK] User ${userId} is not in the Discord guild - assigned default role`,
                    );
                  } else {
                    console.log(
                      `✅ [WEBHOOK] Discord roles synced successfully for user ${userId}`,
                    );
                    console.log(`   Default Role: ${result.defaultRole}`);
                    console.log(`   All Roles: ${result.roles?.join(', ')}`);
                  }
                } else {
                  console.error(
                    `⚠️  [WEBHOOK] Failed to sync Discord roles for user ${userId}:`,
                    result.error,
                  );
                  // Don't fail the webhook, just log the error
                }
              } else {
                console.log(
                  `ℹ️  [WEBHOOK] Event type ${eventType} - no action required`,
                );
              }

              console.log(`\n✅ [WEBHOOK] Webhook processed successfully`);
              console.log('█'.repeat(100) + '\n\n');

              return json({
                received: true,
                timestamp: new Date().toISOString(),
              });
            } catch (error) {
              console.error('\n\n' + '█'.repeat(100));
              console.error('❌ [WEBHOOK] Fatal webhook error:');
              console.error('█'.repeat(100));
              console.error(error);
              console.error('█'.repeat(100) + '\n\n');

              Sentry.captureException(error, {
                tags: { operation: 'webhook-handler' },
              });

              return json(
                { error: 'Webhook processing failed' },
                { status: 500 },
              );
            }
          },
        );
      },
    },
  },
});

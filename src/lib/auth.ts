import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oAuthProxy } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, eq } from "drizzle-orm";
import { createElement } from "react";

import { db } from "@/db";
import { user, session, account, verification, developerProfiles } from "@/db/schema";
import { AuthEmail } from "@/emails/AuthEmail";
import { fetchGuildMember, resolveRoleNames } from "@/lib/discord";
import { sendEmail } from "@/lib/email";

export const auth = betterAuth({
  trustedOrigins: [
    ...(process.env.NODE_ENV === "development" ? ["http://localhost:3000"] : []),
    "https://mr-*-preview.up.railway.app",
  ],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  socialProviders: {
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      scopes: ["identify", "guilds", "guilds.members.read"],
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      scopes: ["read:user"],
    },
  },
  accountLinking: {
    enabled: true,
    trustedProviders: ["discord", "github"],
  },
  // Today we only do social OAuth, but we keep these wired so future
  // email-based flows (verification, magic links, password reset)
  // dispatch via Resend without a follow-up change.
  emailVerification: {
    sendVerificationEmail: async ({ user: recipient, url }) => {
      await sendEmail({
        to: recipient.email,
        subject: "Verify your Brackeys email",
        react: createElement(AuthEmail, {
          variant: "verify",
          recipientName: recipient.name ?? null,
          url,
        }),
        tags: [{ name: "category", value: "auth_verify" }],
      });
    },
  },
  emailAndPassword: {
    enabled: false,
    sendResetPassword: async ({ user: recipient, url }) => {
      await sendEmail({
        to: recipient.email,
        subject: "Reset your Brackeys password",
        react: createElement(AuthEmail, {
          variant: "reset",
          recipientName: recipient.name ?? null,
          url,
        }),
        tags: [{ name: "category", value: "auth_reset" }],
      });
    },
  },
  plugins: [
    tanstackStartCookies(),
    oAuthProxy({
      productionURL: "https://staging.brackeys.dev",
    }),
  ],
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          const [userRecord] = await db
            .select()
            .from(user)
            .where(eq(user.id, session.userId))
            .limit(1);
          if (!userRecord) return;

          // Fetch Discord guild data from the stored access token
          let discordId: string | null = null;
          let guildNickname: string | null = null;
          let guildJoinedAt: Date | null = null;
          let guildRoles: string[] | null = null;

          try {
            const [discordAccount] = await db
              .select()
              .from(account)
              .where(and(eq(account.userId, session.userId), eq(account.providerId, "discord")))
              .limit(1);

            if (discordAccount?.accessToken) {
              discordId = discordAccount.accountId;
              const member = await fetchGuildMember(discordAccount.accessToken);
              guildNickname = member.nick;
              guildJoinedAt = new Date(member.joined_at);
              guildRoles = resolveRoleNames(member.roles);
            }
          } catch {
            // Token may be expired or user not in guild — continue without guild data
          }

          await db
            .insert(developerProfiles)
            .values({
              id: session.userId,
              discordId,
              discordUsername: userRecord.name,
              avatarUrl: userRecord.image,
              guildNickname,
              guildJoinedAt,
              guildRoles,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: developerProfiles.id,
              set: {
                discordId: discordId ?? undefined,
                discordUsername: userRecord.name,
                avatarUrl: userRecord.image,
                guildNickname: guildNickname ?? undefined,
                guildJoinedAt: guildJoinedAt ?? undefined,
                guildRoles: guildRoles ?? undefined,
                updatedAt: new Date(),
              },
            });
        },
      },
    },
  },
});

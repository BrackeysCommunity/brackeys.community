import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oAuthProxy } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { createElement } from "react";

import { db } from "@/db";
import { user, session, account, verification } from "@/db/schema";
import { AuthEmail } from "@/emails/AuthEmail";
import { env, siteOrigin } from "@/env";
import { cleanupUserData } from "@/lib/account-deletion";
import { EVENTS } from "@/lib/analytics-events";
import { sendEmail } from "@/lib/email";
import { applyGuildBanOnSignIn } from "@/lib/guild-ban-gate";
import { syncDiscordProfile } from "@/lib/guild-sync";
import { captureServerEvent } from "@/lib/posthog-server";
import { purgePresence } from "@/lib/presence";

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
      scope: ["identify", "guilds", "guilds.members.read"],
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      scope: ["read:user"],
    },
  },
  account: {
    // NB: these options only work nested under `account.` — a previous
    // top-level `accountLinking` block was silently ignored (linking rode
    // on better-auth's defaults).
    accountLinking: {
      enabled: true,
      trustedProviders: ["discord", "github"],
    },
    // OAuth tokens encrypted at rest under BETTER_AUTH_SECRET (hardening
    // Phase 7). Rows written before this flag are plaintext; better-auth's
    // decrypt throws on them, our direct reads go through
    // `openBetterAuthToken` (tolerant), and rows self-heal on next sign-in.
    encryptOAuthTokens: true,
  },
  user: {
    // Surfaced on the session so the ban check in `src/orpc/middleware/auth.ts`
    // costs no extra query. Never client-writable.
    additionalFields: {
      bannedAt: {
        type: "date",
        required: false,
        input: false,
      },
      // Carried on the session so `isActiveBan` costs the client no query.
      bannedUntil: {
        type: "date",
        required: false,
        input: false,
      },
      unbannedAt: {
        type: "date",
        required: false,
        input: false,
      },
    },
    deleteUser: {
      enabled: true,
      // OAuth-only users have no password, so deletion always goes through
      // an emailed confirmation link before anything is removed.
      sendDeleteAccountVerification: async ({ user: recipient, url }) => {
        await sendEmail({
          to: recipient.email,
          subject: "Confirm deleting your Brackeys account",
          react: createElement(AuthEmail, {
            variant: "delete",
            recipientName: recipient.name ?? null,
            url,
            appUrl: siteOrigin(),
          }),
          tags: [{ name: "category", value: "auth_delete" }],
        });
      },
      // better-auth cascades the auth/collab/notification tables from the
      // user row; app-owned data (developer profile tree, MinIO images) and
      // the guild-membership cache are cleaned up here.
      beforeDelete: async (deletedUser) => {
        await cleanupUserData(deletedUser.id);
      },
      afterDelete: async (deletedUser) => {
        // Best-effort: the presence set's 60s TTL is the backstop.
        await purgePresence(deletedUser.id).catch(() => {});
        // Records that the account is gone; it does *not* erase the person
        // in PostHog. Erasure is still a manual step (PostHog UI, or the
        // person-delete API) — see docs/plans/posthog-migration.md.
        captureServerEvent(EVENTS.authAccountDeleted, deletedUser.id);
      },
    },
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
          appUrl: siteOrigin(),
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
          appUrl: siteOrigin(),
        }),
        tags: [{ name: "category", value: "auth_reset" }],
      });
    },
  },
  plugins: [
    tanstackStartCookies(),
    oAuthProxy({
      productionURL: env.VITE_OAUTH_PROXY_ORIGIN ?? "https://staging.brackeys.dev",
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        // `emailAndPassword` is disabled, so a user row only ever appears on
        // a first completed OAuth flow — this *is* signup.
        after: async (created) => {
          captureServerEvent(EVENTS.authSignedUp, created.id, { provider: "discord" });
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          captureServerEvent(EVENTS.authSignedIn, session.userId, { provider: "discord" });
          // After the sync: the gate is keyed on the Discord id it resolves.
          await syncDiscordProfile(session.userId);
          await applyGuildBanOnSignIn(session.userId);
        },
      },
    },
  },
});

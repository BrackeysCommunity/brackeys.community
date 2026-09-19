import { genericOAuthClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { openDiscordAuthorize } from "@/lib/discord-app-login";
import { EVENTS, type SigninSource } from "@/lib/event-taxonomy";
import { captureEvent } from "@/lib/product-insights";

/**
 * A literal rather than inferred from `typeof auth`, which would pull the server
 * auth module into the browser bundle. Keep in step with `user.additionalFields`.
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "",
  plugins: [
    // `authClient.oauth2.link` — the GitLab instances (src/lib/gitlab-instances.ts).
    genericOAuthClient(),
    inferAdditionalFields({
      user: {
        bannedAt: { type: "date", required: false },
        bannedUntil: { type: "date", required: false },
        unbannedAt: { type: "date", required: false },
      },
    }),
  ],
});

type SocialSignInOptions = Omit<Parameters<typeof authClient.signIn.social>[0], "provider">;

type SignInWithDiscordOptions = SocialSignInOptions & {
  /**
   * `"app"` runs the consent screen in the Discord desktop client (see
   * `@/lib/discord-app-login`) instead of the browser's discord.com session.
   */
  via?: "web" | "app";
};

/**
 * Discord sign-in that returns to the page it was started from. An explicit
 * callbackURL is required: without one, the oAuthProxy flow (dev/preview
 * environments) falls back to the auth base URL and lands on a 404 at
 * `/api/auth`.
 *
 * `source` is required so every CTA is distinguishable in the acquisition
 * funnel — capturing here means no future sign-in button can forget the
 * event.
 *
 * ## Why the id, and why it rides in `additionalData`
 *
 * The OAuth return is a fresh page load, and cookieless mode mints a new
 * anonymous person per load — so the visitor who pressed the button and the
 * person who comes back identified are two different people in PostHog, and
 * no funnel joins them. `auth_signin_started` carries the `source`;
 * `auth_signed_in` fires server-side on the far side of the redirect and
 * historically carried nothing but the provider.
 *
 * better-auth's `additionalData` is spread into the OAuth state it signs and
 * stores (`better-auth/dist/oauth2/state.mjs`), and the callback puts the
 * parsed state back into request-scoped storage, where the database hooks in
 * `@/lib/auth` read it. So both halves end up carrying the same attempt id
 * and the same source, and the join happens on a property instead of on an
 * identity cookieless mode cannot provide.
 *
 * The id is a per-attempt random value with nothing derived from the person
 * in it — it is a join key for two events minutes apart, not an identifier
 * that outlives the flow.
 */
export async function signInWithDiscord(source: SigninSource, options?: SignInWithDiscordOptions) {
  const { via = "web", ...socialOptions } = options ?? {};
  const signinAttemptId = newSigninAttemptId();
  captureEvent(EVENTS.authSigninStarted, {
    source,
    provider: "discord",
    signin_attempt_id: signinAttemptId,
    via,
  });
  const result = await authClient.signIn.social({
    provider: "discord",
    callbackURL: window.location.pathname + window.location.search,
    additionalData: { signinAttemptId, signinSource: source },
    ...socialOptions,
    // The app route needs the authorize URL in hand rather than followed.
    ...(via === "app" ? { disableRedirect: true } : {}),
  });
  if (via === "app" && result.data?.url) openDiscordAuthorize(result.data.url);
  return result;
}

/**
 * `crypto.randomUUID` needs a secure context, which every origin this runs on
 * has — but a stray http:// preview would throw where it used to sign in, so
 * the fallback keeps sign-in working and only degrades the join key.
 */
function newSigninAttemptId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sa_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Where GitHub OAuth comes back to — the route that syncs the link into
 * `linked_accounts`. Also the error handoff, so a cancelled consent screen
 * lands in the app rather than better-auth's own `/api/auth/error` page.
 */
const GITHUB_CALLBACK_PATH = "/oauth/github/callback";

/**
 * Attach GitHub to the **signed-in** member.
 *
 * `linkSocial`, never `signIn.social`: the sign-in route has no session to
 * work from, so better-auth resolves the account by GitHub email alone
 * (`findOAuthUser` in `oauth2/link-account`). A member whose GitHub address
 * differs from their Discord one therefore looks like a brand new signup,
 * and `disableSignUp` refuses it — the member gets bounced to
 * `/auth/error?error=signup_disabled` before ever reaching the callback.
 * `accountLinking.allowDifferentEmails` can't rescue it, because that check
 * only runs once a user has already been found by email.
 *
 * The link route carries the session, so the member is known up front and
 * no email has to match.
 */
export async function startGitHubLink(): Promise<void> {
  captureEvent(EVENTS.accountLinkStarted, { provider: "github" });
  const { error } = await authClient.linkSocial({
    provider: "github",
    callbackURL: GITHUB_CALLBACK_PATH,
    errorCallbackURL: GITHUB_CALLBACK_PATH,
  });
  if (error) throw new Error(error.message || "Failed to start GitHub OAuth");
}

export type Session = typeof authClient.$Infer.Session;

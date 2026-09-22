import { genericOAuthClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import {
  openDiscordAuthorize,
  type SigninRoute,
  withDiscordAppReturn,
} from "@/lib/discord-app-login";
import { EVENTS, type SigninSource } from "@/lib/event-taxonomy";
import { gitlabCallbackPath } from "@/lib/gitlab-instances";
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
   * `@/lib/discord-app-login`) so the account is the one the app is signed
   * into, not whatever discord.com session the browser holds. `"web"` is the
   * plain browser flow. Unset, the browser's remembered route wins, and a
   * browser with no history starts on the web flow — the handoff to the
   * desktop client is a prompt most people do not need, and a browser that
   * completes it once is remembered from then on.
   */
  via?: SigninRoute;
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
  const { via: viaOption, ...socialOptions } = options ?? {};
  // const via = viaOption ?? rememberedSigninRoute() ?? "web";
  const via = viaOption ?? "web";
  const signinAttemptId = newSigninAttemptId();
  captureEvent(EVENTS.authSigninStarted, {
    source,
    provider: "discord",
    signin_attempt_id: signinAttemptId,
    via,
  });
  const callbackURL = window.location.pathname + window.location.search;
  const result = await authClient.signIn.social({
    provider: "discord",
    callbackURL: via === "app" ? withDiscordAppReturn(callbackURL) : callbackURL,
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
  captureEvent(EVENTS.accountLinkStarted, { provider: "github", surface: "profile" });
  const { error } = await authClient.linkSocial({
    provider: "github",
    callbackURL: GITHUB_CALLBACK_PATH,
    errorCallbackURL: GITHUB_CALLBACK_PATH,
  });
  if (error) throw new Error(error.message || "Failed to start GitHub OAuth");
}

/**
 * Attach a GitLab instance to the signed-in member. `oauth2.link` rather
 * than `signIn.oauth2`, for the same reason as GitHub above. Both handoffs
 * go to the instance's callback route so a cancelled consent screen lands
 * back in the app.
 */
export async function startGitLabLink(providerId: string): Promise<void> {
  captureEvent(EVENTS.accountLinkStarted, { provider: providerId, surface: "profile" });
  const callback = gitlabCallbackPath(providerId);
  const result = await authClient.oauth2.link({
    providerId,
    callbackURL: callback,
    errorCallbackURL: callback,
  });
  if (result?.error) throw new Error(result.error.message || "Failed to start GitLab OAuth");
}

/**
 * Where the sign-in identity page sends the member back after a link.
 * Unlike the profile integrations there is no sync step to run on return —
 * better-auth's `account` row is the whole result — so the return lands on
 * the page itself, and no `account_link_completed` is emitted for it. The
 * page also takes the provider's error handoff (`src/routes/settings.account.tsx`).
 */
const SETTINGS_ACCOUNT_PATH = "/settings/account";

/**
 * Attach a provider as a **sign-in identity** from `/settings/account`.
 * A GitHub link started here and one started from the profile are the same
 * OAuth exchange with different landings; the `surface` on the start event
 * is what keeps the funnel from counting this one as drop-off.
 */
export async function linkSigninProvider(provider: "discord" | "github"): Promise<void> {
  captureEvent(EVENTS.accountLinkStarted, { provider, surface: "settings" });
  const { error } = await authClient.linkSocial({
    provider,
    callbackURL: SETTINGS_ACCOUNT_PATH,
    errorCallbackURL: SETTINGS_ACCOUNT_PATH,
  });
  if (error) throw new Error(error.message || "Could not start linking");
}

export type Session = typeof authClient.$Infer.Session;

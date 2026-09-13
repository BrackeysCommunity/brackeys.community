import { getOAuthState } from "better-auth/api";

import type { SigninSource } from "@/lib/event-taxonomy";

/**
 * The far side of the OAuth correlation id minted in `@/lib/auth-client`.
 *
 * Cookieless analytics has no persistent anonymous id, so the visitor who
 * pressed SIGN IN and the person who returns identified are two different
 * people in PostHog. `signInWithDiscord` therefore hands better-auth an
 * attempt id and the CTA that started it as `additionalData`; better-auth
 * spreads that into the signed OAuth state, and the callback parses the state
 * back into request-scoped storage before it creates the user or the session.
 * The database hooks run inside that same request, so this reads it back and
 * the two halves of the sign-in join on a property.
 *
 * Everything here is best-effort by construction. A session created by
 * anything other than an OAuth callback has no state to read, an older
 * browser tab may have started its flow before the id existed, and a
 * better-auth upgrade could move the storage — in each case the events simply
 * carry no attempt id, exactly as they did before this existed.
 */
export interface SigninAttempt {
  signin_attempt_id?: string;
  source?: SigninSource;
}

export async function readSigninAttempt(): Promise<SigninAttempt> {
  let state: Awaited<ReturnType<typeof getOAuthState>>;
  try {
    state = await getOAuthState();
  } catch {
    // Outside a request, or the storage moved — neither is worth a throw on
    // the sign-in path.
    return {};
  }
  if (!state) return {};

  // `OAuthState` carries an index signature, so these are `any` until proven
  // otherwise. The values came back through better-auth's own signed state,
  // but they started life in a browser: narrow them rather than trusting the
  // round trip, so a tampered state can't put an object into an event
  // property.
  const attempt: SigninAttempt = {};
  if (typeof state.signinAttemptId === "string" && state.signinAttemptId.length <= 64) {
    attempt.signin_attempt_id = state.signinAttemptId;
  }
  if (typeof state.signinSource === "string" && state.signinSource.length <= 64) {
    attempt.source = state.signinSource as SigninSource;
  }
  return attempt;
}

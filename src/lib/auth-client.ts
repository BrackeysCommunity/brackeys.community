import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * A literal rather than inferred from `typeof auth`, which would pull the server
 * auth module into the browser bundle. Keep in step with `user.additionalFields`.
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "",
  plugins: [
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

/**
 * Discord sign-in that returns to the page it was started from. An explicit
 * callbackURL is required: without one, the oAuthProxy flow (dev/preview
 * environments) falls back to the auth base URL and lands on a 404 at
 * `/api/auth`.
 */
export function signInWithDiscord(options?: SocialSignInOptions) {
  return authClient.signIn.social({
    provider: "discord",
    callbackURL: window.location.pathname + window.location.search,
    ...options,
  });
}

export type Session = typeof authClient.$Infer.Session;

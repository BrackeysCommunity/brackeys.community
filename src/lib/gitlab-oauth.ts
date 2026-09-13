import type { GenericOAuthConfig } from "better-auth/plugins";

import { fetchGitLabUser } from "@/lib/gitlab";
import { GITLAB_INSTANCES, gitlabOrigin, type GitLabInstance } from "@/lib/gitlab-instances";

/**
 * Server-only half of the GitLab registry: credentials, and the better-auth
 * provider configs built from them. An instance with no client id is absent
 * from the menu rather than broken in it, so this is the one place that
 * decides whether an instance exists at runtime.
 */

/**
 * A client id is all an instance needs. GitLab applications can be
 * registered **non-confidential**, which is a public PKCE client: no
 * secret exists to hold, leak or rotate, and better-auth's token exchange
 * simply omits `client_secret` when there isn't one. A secret is still
 * honoured for an instance whose admin only permits confidential apps.
 *
 * The id is not sensitive — it rides in the authorization URL the member's
 * own browser carries — so this is the pair-of-secrets problem reduced to
 * a list of names.
 */
function credentials(instance: GitLabInstance): { clientId: string; clientSecret?: string } | null {
  const clientId = process.env[`${instance.envPrefix}_CLIENT_ID`];
  if (!clientId) return null;
  const clientSecret = process.env[`${instance.envPrefix}_CLIENT_SECRET`];
  return clientSecret ? { clientId, clientSecret } : { clientId };
}

export function configuredGitLabInstances(): GitLabInstance[] {
  return GITLAB_INSTANCES.filter((instance) => credentials(instance) !== null);
}

export function isGitLabInstanceConfigured(providerId: string): boolean {
  return configuredGitLabInstances().some((i) => i.providerId === providerId);
}

export function gitlabOAuthConfigs(): GenericOAuthConfig[] {
  return GITLAB_INSTANCES.flatMap((instance) => {
    const creds = credentials(instance);
    if (!creds) return [];

    return [
      {
        providerId: instance.providerId,
        ...creds,
        discoveryUrl: `${gitlabOrigin(instance)}/.well-known/openid-configuration`,
        scopes: ["read_user"],
        // Required for a non-confidential application, and harmless for a
        // confidential one — GitLab advertises S256.
        pkce: true,
        // Only Discord mints users — the `user.create` hook assumes so, and a
        // GitLab login started while signed out must end without an account.
        disableSignUp: true,
        getUserInfo: async (tokens) => {
          if (!tokens.accessToken) return null;
          const user = await fetchGitLabUser(instance, tokens.accessToken).catch(() => null);
          if (!user) return null;
          return {
            id: String(user.id),
            name: user.name ?? user.username,
            image: user.avatar_url ?? undefined,
            // better-auth refuses a user-info object with no email, and an
            // instance can withhold one. Nothing is ever mailed here and no
            // user row is created (`disableSignUp`), so a non-routable
            // placeholder is the honest stand-in.
            email: user.email ?? `${user.username}@${instance.host}.invalid`,
            // We never asked for an email scope, so nothing here is proven.
            // Linking rides on the session instead — see `allowDifferentEmails`.
            emailVerified: false,
          };
        },
      } satisfies GenericOAuthConfig,
    ];
  });
}

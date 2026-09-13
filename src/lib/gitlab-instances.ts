/**
 * The GitLab instances a member can link an account on.
 *
 * OAuth needs an application registered on each instance, so the list is
 * fixed rather than member-supplied. Each entry is its own better-auth
 * `genericOAuth` provider — the built-in `gitlab` social provider carries
 * exactly one instance, and the guild uses three.
 *
 * Client-safe: ids, hosts and labels only. Which instances are actually
 * configured is a server fact (`gitlabOAuthConfigs`), reached from the UI
 * through `listGitLabInstances`.
 */
export interface GitLabInstance {
  /** better-auth `providerId` and `linked_accounts.provider` for this instance. */
  providerId: string;
  /** Bare host, no scheme: `gitlab.com`, `git.booth.dev`. */
  host: string;
  /** Menu label. The row label is always `GITLAB`; the host is the sub-line. */
  label: string;
  /** Env prefix for the instance's credentials: `<prefix>_CLIENT_ID` / `_SECRET`. */
  envPrefix: string;
}

export const GITLAB_INSTANCES: readonly GitLabInstance[] = [
  { providerId: "gitlab", host: "gitlab.com", label: "GitLab", envPrefix: "GITLAB" },
  {
    providerId: "gitlab-booth",
    host: "git.booth.dev",
    label: "GitLab · git.booth.dev",
    envPrefix: "GITLAB_BOOTH",
  },
  {
    providerId: "gitlab-brackeys",
    host: "git.brackeys.dev",
    label: "GitLab · git.brackeys.dev",
    envPrefix: "GITLAB_BRACKEYS",
  },
];

export function gitlabInstance(providerId: string): GitLabInstance | undefined {
  return GITLAB_INSTANCES.find((i) => i.providerId === providerId);
}

export function isGitLabProvider(providerId: string): boolean {
  return gitlabInstance(providerId) !== undefined;
}

/** `gitlab.com` is the hosted one; everything else is somebody's server. */
export function isSelfHostedGitLab(instance: GitLabInstance): boolean {
  return instance.host !== "gitlab.com";
}

export function gitlabOrigin(instance: GitLabInstance): string {
  return `https://${instance.host}`;
}

/** Where the OAuth flow returns to once the instance has redirected back. */
export function gitlabCallbackPath(providerId: string): string {
  return `/oauth/gitlab/${providerId}/callback`;
}

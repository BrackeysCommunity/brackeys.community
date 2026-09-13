import { gitlabOrigin, type GitLabInstance } from "@/lib/gitlab-instances";

const CALENDAR_TIMEOUT_MS = 5_000;

export interface GitLabUser {
  id: number;
  username: string;
  name: string | null;
  avatar_url: string | null;
  web_url: string;
  /** Present with `read_user` on most instances; better-auth's callback
   *  refuses a user-info object without one. */
  email?: string | null;
}

export class GitLabApiError extends Error {
  constructor(
    readonly status: number,
    readonly host: string,
  ) {
    super(`GitLab API error (${status}) on ${host}`);
    this.name = "GitLabApiError";
  }
}

/**
 * The signed-in user on one instance. `read_user` is the only scope we ask
 * for, and `/api/v4/user` is all it opens.
 */
export async function fetchGitLabUser(
  instance: GitLabInstance,
  accessToken: string,
): Promise<GitLabUser> {
  const res = await fetch(`${gitlabOrigin(instance)}/api/v4/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) throw new GitLabApiError(res.status, instance.host);

  return res.json() as Promise<GitLabUser>;
}

/**
 * A year of daily contribution counts for one member on one instance.
 *
 * `calendar.json` is a Rails route rather than `/api/v4`, so it takes no
 * token: a public profile answers anonymously, and a private or unknown one
 * **302s to `/users/sign_in`** rather than 404ing. That redirect is the
 * "no graph" signal, and following it would hand back a sign-in page that
 * parses as nothing. Verified against gitlab.com on 2026-09-12: 200,
 * `{"YYYY-MM-DD": n}`, exactly the trailing 366 days.
 *
 * The hosts are the fixed registry, not member input, so this is a request
 * to an instance the deployment already trusts with its OAuth secret —
 * unlike `website-verification-check.ts`, which is the member-supplied case
 * and carries the address guard to match.
 */
export async function fetchGitLabCalendar(
  instance: GitLabInstance,
  username: string,
): Promise<Record<string, number> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALENDAR_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${gitlabOrigin(instance)}/users/${encodeURIComponent(username)}/calendar.json`,
      { redirect: "manual", signal: controller.signal, headers: { Accept: "application/json" } },
    );
    // 3xx is the sign-in bounce: the profile isn't public, so there is no
    // graph to draw rather than an error to report.
    if (res.status !== 200) return null;

    const raw: unknown = await res.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

    const days: Record<string, number> = {};
    for (const [date, count] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
      days[date] = Math.floor(count);
    }
    return days;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

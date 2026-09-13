const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const GITHUB_API_URL = "https://api.github.com";

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  name: string | null;
  bio: string | null;
}

/** GitHub's own calendar shape. The app's merged model — every forge, one
 *  grid — is `@/lib/contributions`; this is only what the GraphQL returns. */
export interface GitHubContributionDay {
  date: string;
  contributionCount: number;
  color: string;
}

export interface GitHubContributionWeek {
  contributionDays: GitHubContributionDay[];
}

export interface GitHubContributionCalendar {
  totalContributions: number;
  weeks: GitHubContributionWeek[];
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API error (${res.status})`);
  }

  return res.json() as Promise<GitHubUser>;
}

export async function fetchContributionCalendar(
  accessToken: string,
  username: string,
): Promise<GitHubContributionCalendar> {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(now.getFullYear() - 1);

  const query = `
    query($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
                color
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        username,
        from: oneYearAgo.toISOString(),
        to: now.toISOString(),
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL error (${res.status})`);
  }

  const json = (await res.json()) as {
    data?: {
      user?: { contributionsCollection?: { contributionCalendar?: GitHubContributionCalendar } };
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }

  const calendar = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) {
    throw new Error("No contribution data found");
  }

  return calendar;
}

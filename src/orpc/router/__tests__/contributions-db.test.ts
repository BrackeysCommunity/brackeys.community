import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, linkedAccounts, user } from "@/db/schema";
import type { ContributionCalendarData } from "@/lib/contributions";
import { getContributions } from "@/orpc/router/contributions";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github")>()),
  fetchContributionCalendar: vi.fn(),
}));
vi.mock("@/lib/gitlab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gitlab")>()),
  fetchGitLabCalendar: vi.fn(),
}));

const { fetchContributionCalendar } = await import("@/lib/github");
const { fetchGitLabCalendar } = await import("@/lib/gitlab");
const githubMock = vi.mocked(fetchContributionCalendar);
const gitlabMock = vi.mocked(fetchGitLabCalendar);

/**
 * The graph is anonymous and edge-cached, so what matters here is which
 * links it reaches for and what it does when one of them doesn't answer —
 * half a year of dots beats an empty card.
 */

let db: TestDb;
const today = new Date().toISOString().slice(0, 10);

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(linkedAccounts);
  await db.delete(developerProfiles);
  await db.delete(user);
  githubMock.mockReset();
  gitlabMock.mockReset();
});

async function link(profileId: string, provider: string, username: string) {
  await db.insert(linkedAccounts).values({
    profileId,
    provider,
    providerUserId: `${provider}-1`,
    providerUsername: username,
    accessToken: "token",
  });
}

function githubCalendar(date: string, count: number) {
  return {
    totalContributions: count,
    weeks: [{ contributionDays: [{ date, contributionCount: count, color: "#fff" }] }],
  };
}

function dayToday(calendar: ContributionCalendarData) {
  return calendar.weeks.flatMap((w) => w.contributionDays).find((d) => d.date === today)!;
}

describe("getContributions", () => {
  it("answers nothing when the member has linked no forge", async () => {
    await seedUser(db, "u1");

    expect(await call(getContributions, { userId: "u1" }, asUser(null))).toBeNull();
  });

  it("sums GitHub and a GitLab instance into one day, keeping the split", async () => {
    await seedUser(db, "u1");
    await link("u1", "github", "yasa");
    await link("u1", "gitlab-brackeys", "yasahiro");
    githubMock.mockResolvedValue(githubCalendar(today, 3));
    gitlabMock.mockResolvedValue({ [today]: 2 });

    const calendar = (await call(getContributions, { userId: "u1" }, asUser(null)))!;

    expect(dayToday(calendar)).toMatchObject({
      contributionCount: 5,
      bySource: { github: 3, "gitlab-brackeys": 2 },
    });
    expect(calendar.sources).toEqual([
      { key: "github", label: "GITHUB" },
      { key: "gitlab-brackeys", label: "git.brackeys.dev" },
    ]);
  });

  it("labels gitlab.com by name and a self-hosted instance by host", async () => {
    await seedUser(db, "u1");
    await link("u1", "gitlab", "yasa");
    gitlabMock.mockResolvedValue({ [today]: 1 });

    const calendar = (await call(getContributions, { userId: "u1" }, asUser(null)))!;

    expect(calendar.sources).toEqual([{ key: "gitlab", label: "GITLAB" }]);
  });

  it("draws the sources that did answer when one fails", async () => {
    await seedUser(db, "u1");
    await link("u1", "github", "yasa");
    await link("u1", "gitlab-brackeys", "yasahiro");
    githubMock.mockRejectedValue(new Error("401"));
    gitlabMock.mockResolvedValue({ [today]: 7 });

    const calendar = (await call(getContributions, { userId: "u1" }, asUser(null)))!;

    expect(calendar.totalContributions).toBe(7);
    expect(calendar.sources.map((s) => s.key)).toEqual(["gitlab-brackeys"]);
  });

  it("ignores a linked account no forge in the registry owns", async () => {
    await seedUser(db, "u1");
    await link("u1", "itchio", "yasa");

    expect(await call(getContributions, { userId: "u1" }, asUser(null))).toBeNull();
    expect(gitlabMock).not.toHaveBeenCalled();
  });

  it("asks each instance for that instance's own username", async () => {
    await seedUser(db, "u1");
    await link("u1", "gitlab", "hosted-name");
    await link("u1", "gitlab-booth", "booth-name");
    gitlabMock.mockResolvedValue({});

    await call(getContributions, { userId: "u1" }, asUser(null));

    const asked = gitlabMock.mock.calls.map(([instance, username]) => [instance.host, username]);
    expect(asked).toEqual([
      ["gitlab.com", "hosted-name"],
      ["git.booth.dev", "booth-name"],
    ]);
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  assignSourceHues,
  buildContributionCalendar,
  contributionCellStyle,
  contributionTooltip,
  weeksToDayMap,
  type ContributionDay,
  type ContributionSource,
} from "@/lib/contributions";

/**
 * The grid is the contract the renderer already assumed when GitHub was the
 * only source: Sunday-started columns, the last one stopping at today. What
 * is new is that a day carries its split, and that summing is not allowed to
 * lose it.
 */

const TODAY = new Date("2026-09-12T17:30:00Z"); // a Saturday
const GITHUB: ContributionSource = { key: "github", label: "GITHUB" };
const BRACKEYS: ContributionSource = { key: "gitlab-brackeys", label: "git.brackeys.dev" };

function flatten(calendar: NonNullable<ReturnType<typeof buildContributionCalendar>>) {
  return calendar.weeks.flatMap((w) => w.contributionDays);
}

describe("buildContributionCalendar", () => {
  it("returns nothing when no source answered", () => {
    expect(buildContributionCalendar([], TODAY)).toBeNull();
  });

  it("lays out Sunday-started weeks ending on today", () => {
    const calendar = buildContributionCalendar([{ source: GITHUB, days: {} }], TODAY)!;
    const days = flatten(calendar);

    expect(days[days.length - 1]!.date).toBe("2026-09-12");
    expect(new Date(`${days[0]!.date}T00:00:00Z`).getUTCDay()).toBe(0);
    // A year of columns, and every column but the last is a full week.
    expect(calendar.weeks.length).toBe(53);
    for (const week of calendar.weeks.slice(0, -1)) {
      expect(week.contributionDays).toHaveLength(7);
    }
    expect(days.length).toBeGreaterThanOrEqual(365);
  });

  it("sums a day across sources while keeping the split", () => {
    const calendar = buildContributionCalendar(
      [
        { source: GITHUB, days: { "2026-09-10": 3 } },
        { source: BRACKEYS, days: { "2026-09-10": 2, "2026-09-11": 4 } },
      ],
      TODAY,
    )!;
    const days = flatten(calendar);
    const mixed = days.find((d) => d.date === "2026-09-10")!;
    const soloGitlab = days.find((d) => d.date === "2026-09-11")!;

    expect(mixed.contributionCount).toBe(5);
    expect(mixed.bySource).toEqual({ github: 3, "gitlab-brackeys": 2 });
    expect(soloGitlab.bySource).toEqual({ "gitlab-brackeys": 4 });
    expect(calendar.totalContributions).toBe(9);
  });

  it("drops a linked source that contributed nothing inside the window", () => {
    const calendar = buildContributionCalendar(
      [
        { source: GITHUB, days: { "2026-09-10": 1 } },
        { source: BRACKEYS, days: {} },
      ],
      TODAY,
    )!;

    expect(calendar.sources).toEqual([GITHUB]);
  });

  it("ignores days outside the window", () => {
    const calendar = buildContributionCalendar(
      [{ source: GITHUB, days: { "2020-01-01": 99, "2026-09-13": 42 } }],
      TODAY,
    )!;

    expect(calendar.totalContributions).toBe(0);
    expect(flatten(calendar).some((d) => d.date === "2026-09-13")).toBe(false);
  });

  it("keeps every day empty rather than null when a source has no activity", () => {
    const calendar = buildContributionCalendar([{ source: GITHUB, days: {} }], TODAY)!;

    expect(calendar.totalContributions).toBe(0);
    expect(calendar.sources).toEqual([]);
    expect(flatten(calendar).every((d) => d.contributionCount === 0)).toBe(true);
  });
});

describe("weeksToDayMap", () => {
  it("flattens GitHub's buckets and drops the empty days", () => {
    expect(
      weeksToDayMap([
        {
          contributionDays: [
            { date: "2026-09-06", contributionCount: 0 },
            { date: "2026-09-07", contributionCount: 3 },
          ],
        },
      ]),
    ).toEqual({ "2026-09-07": 3 });
  });
});

describe("assignSourceHues", () => {
  it("pins GitHub to the primary colour wherever it appears in the order", () => {
    const hues = assignSourceHues([BRACKEYS, GITHUB]);

    expect(hues.get("github")).toBe("var(--primary)");
    expect(hues.get("gitlab-brackeys")).toBe("var(--warning)");
  });

  it("gives every other source a distinct colour", () => {
    const sources = [
      GITHUB,
      { key: "gitlab", label: "GITLAB" },
      { key: "gitlab-booth", label: "git.booth.dev" },
      BRACKEYS,
    ];
    const hues = assignSourceHues(sources);

    expect(new Set(hues.values()).size).toBe(sources.length);
  });
});

describe("painting a day", () => {
  const hues = assignSourceHues([GITHUB, BRACKEYS]);
  const day = (bySource: Record<string, number>): ContributionDay => ({
    date: "2026-09-10",
    contributionCount: Object.values(bySource).reduce((a, b) => a + b, 0),
    bySource,
  });

  it("leaves an empty day to the muted class", () => {
    expect(contributionCellStyle(day({}), 0, hues)).toBeUndefined();
  });

  it("fills a single-source day flat, at the intensity's own alpha", () => {
    expect(contributionCellStyle(day({ github: 4 }), 2, hues)).toEqual({
      background: "color-mix(in srgb, var(--primary) 50%, transparent)",
    });
  });

  it("splits a mixed day diagonally, the bigger contributor first", () => {
    const style = contributionCellStyle(day({ github: 1, "gitlab-brackeys": 9 }), 4, hues)!;

    expect(style.background).toBe(
      "linear-gradient(135deg, color-mix(in srgb, var(--warning) 100%, transparent) 0 50%, " +
        "color-mix(in srgb, var(--primary) 100%, transparent) 50% 100%)",
    );
  });

  it("ignores a source the legend has no colour for", () => {
    expect(contributionCellStyle(day({ unknown: 3 }), 3, hues)).toBeUndefined();
  });
});

describe("the day tooltip", () => {
  const day: ContributionDay = {
    date: "2026-09-10",
    contributionCount: 5,
    bySource: { github: 3, "gitlab-brackeys": 2 },
  };

  it("stays a plain count when there is only one forge", () => {
    expect(contributionTooltip(day, [GITHUB])).toBe("2026-09-10: 5 contributions");
  });

  it("names the split when the day came from more than one", () => {
    expect(contributionTooltip(day, [GITHUB, BRACKEYS])).toBe(
      "2026-09-10: 5 contributions — 3 GITHUB, 2 git.brackeys.dev",
    );
  });

  it("does not pretend a single-source day is split", () => {
    const solo = { ...day, contributionCount: 3, bySource: { github: 3 } };
    expect(contributionTooltip(solo, [GITHUB, BRACKEYS])).toBe("2026-09-10: 3 contributions");
  });

  it("says 'contribution' for exactly one", () => {
    const one = { date: "2026-09-10", contributionCount: 1, bySource: { github: 1 } };
    expect(contributionTooltip(one, [GITHUB])).toBe("2026-09-10: 1 contribution");
  });
});

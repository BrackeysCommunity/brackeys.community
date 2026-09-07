import { describe, expect, test } from "bun:test";

import { ctx, fakeApi, jam, NOW, unix } from "../../test/fake-api.ts";
import { EMBED_TOTAL_MAX, embedLength } from "../reply.ts";
import { decodeCustomId } from "./custom-id.ts";
import { jamEmbed, jamPhase } from "./format.ts";
import {
  ENTRIES_PAGE_SIZE,
  jamEntries,
  jamEntriesPage,
  jamInfo,
  jamNow,
  jamResults,
  pickCurrentJam,
} from "./jam.ts";

describe("jam phases against a fixed clock", () => {
  test("running, voting, upcoming, ended", () => {
    expect(jamPhase(jam({ startDays: -3, endDays: 4 }), NOW)).toBe("running");
    expect(jamPhase(jam({ startDays: -10, endDays: -1, votingDays: 6 }), NOW)).toBe("voting");
    expect(jamPhase(jam({ startDays: 2, endDays: 9 }), NOW)).toBe("upcoming");
    expect(jamPhase(jam({ startDays: -30, endDays: -20, votingDays: -13 }), NOW)).toBe("ended");
  });

  test("a jam with no votingEndsAt never claims a voting phase", () => {
    expect(jamPhase(jam({ startDays: -10, endDays: -1, votingDays: null }), NOW)).toBe("ended");
  });

  test("the embed's countdown is Discord markup, not a formatted date", () => {
    const j = jam({ startDays: -3, endDays: 4 });
    const embed = jamEmbed(j, ctx);
    expect(embed.description).toBe(
      `**SUBMISSIONS OPEN** · Submissions close <t:${unix(j.endsAt)}:R>`,
    );
    expect(embed.url).toBe("https://brackeys.test/jams/brackeys-14");
    expect(embed.image).toBe(j.bannerUrl!);
    expect(embed.color).toBe(0xff3366);
    expect(JSON.stringify(embed)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("pickCurrentJam", () => {
  test("running beats voting beats upcoming, and the fallback is the latest ended", () => {
    const running = jam({ jamId: 1, startDays: -1, endDays: 1 });
    const voting = jam({ jamId: 2, startDays: -10, endDays: -1, votingDays: 3 });
    const upcoming = jam({ jamId: 3, startDays: 5, endDays: 12 });
    const soonerUpcoming = jam({ jamId: 4, startDays: 2, endDays: 9 });
    const ended = jam({ jamId: 5, startDays: -60, endDays: -50, votingDays: -43 });
    const endedLater = jam({ jamId: 6, startDays: -40, endDays: -30, votingDays: -23 });

    expect(pickCurrentJam([ended, upcoming, voting, running], NOW)?.jamId).toBe(1);
    expect(pickCurrentJam([ended, upcoming, voting], NOW)?.jamId).toBe(2);
    expect(pickCurrentJam([ended, upcoming, soonerUpcoming], NOW)?.jamId).toBe(4);
    expect(pickCurrentJam([ended, endedLater], NOW)?.jamId).toBe(6);
    expect(pickCurrentJam([], NOW)).toBeNull();
  });
});

describe("/jam now", () => {
  test("is public and carries both links", async () => {
    const api = fakeApi({
      listJamsByHost: async (input: { hostName: string }) => {
        expect(input.hostName).toBe("Brackeys");
        return { jams: [jam()] };
      },
    });
    const reply = await jamNow(api, ctx);
    expect(reply.ephemeral).toBe(false);
    expect(reply.outcome).toBe("hit");
    expect(reply.embeds[0]?.title).toBe("Brackeys Game Jam 2026.1");
    expect(reply.buttons).toEqual([
      {
        kind: "link",
        label: "Open on brackeys.dev",
        url: "https://brackeys.test/jams/brackeys-14",
      },
      { kind: "link", label: "itch.io", url: "https://itch.io/jam/brackeys-14" },
    ]);
  });

  test("no host jams → not_found", async () => {
    const reply = await jamNow(fakeApi({ listJamsByHost: async () => ({ jams: [] }) }), ctx);
    expect(reply.outcome).toBe("not_found");
    expect(reply.ephemeral).toBe(true);
  });
});

describe("/jam info", () => {
  test("adds host, length and the community line; ephemeral unless shared", async () => {
    const api = fakeApi({
      getJam: async ({ idOrSlug }: { idOrSlug: string }) => {
        expect(idOrSlug).toBe("brackeys-14");
        return { jam: jam(), trackedEntries: 550, hasResults: false };
      },
      getJamCommunity: async () => ({
        members: [],
        teams: [{}, {}],
        openPostCount: 3,
        declared: [],
        declaredCount: 12,
      }),
    });
    const reply = await jamInfo(api, { jam: "brackeys-14" }, ctx);
    expect(reply.ephemeral).toBe(true);
    const embed = reply.embeds[0]!;
    expect(embed.description).toContain(
      "12 members from this server are entering · 2 teams · [3 open team posts]",
    );
    expect(embed.description).toContain("550 entries tracked");
    expect(embed.fields?.map((f) => f.name)).toEqual([
      "Starts",
      "Ends",
      "Voting ends",
      "Host",
      "Length",
      "Entries",
      "Joined",
    ]);
    expect(embed.fields?.find((f) => f.name === "Length")?.value).toBe("7 days");

    const shared = await jamInfo(api, { jam: "brackeys-14", share: true }, ctx);
    expect(shared.ephemeral).toBe(false);
  });

  test("a failing community read costs one line, not the reply", async () => {
    const api = fakeApi({
      getJam: async () => ({ jam: jam(), trackedEntries: 0, hasResults: false }),
    });
    const reply = await jamInfo(api, { jam: "brackeys-14" }, ctx);
    expect(reply.outcome).toBe("hit");
    expect(reply.embeds[0]?.description).toBe(
      `**SUBMISSIONS OPEN** · Submissions close <t:${unix(jam().endsAt)}:R>`,
    );
  });

  test("an unknown jam is not_found with the input echoed", async () => {
    const reply = await jamInfo(fakeApi({ getJam: async () => null }), { jam: "nope" }, ctx);
    expect(reply.outcome).toBe("not_found");
    expect(reply.content).toContain("**nope**");
  });
});

describe("/jam entries", () => {
  const entry = (i: number, title = `Game ${i}`) => ({
    entryId: i,
    gameId: i,
    gameTitle: title,
    gameShortText: null,
    gameUrl: `https://someone.itch.io/game-${i}`,
    gameCoverUrl: null,
    gameCoverColor: null,
    gamePlatforms: null,
    rateUrl: `/jam/brackeys-14/rate/${i}`,
    ratingCount: i * 3,
    coolness: 0,
    submittedAt: null,
    authorId: null,
    authorName: `Author ${i}`,
    authorUrl: null,
    contributors: null,
    rank: i <= 3 ? i : null,
    members: i === 1 ? [{ profileId: "p", username: "x", avatarUrl: null, urlStub: null }] : [],
  });

  function entriesApi(total: number, seen: unknown[] = []) {
    return fakeApi({
      getJam: async () => ({ jam: jam(), trackedEntries: total, hasResults: true }),
      listJamEntries: async (input: {
        page: number;
        pageSize: number;
        sortBy: string;
        search: string;
      }) => {
        seen.push(input);
        const start = input.page * input.pageSize;
        const n = Math.max(0, Math.min(input.pageSize, total - start));
        return { entries: Array.from({ length: n }, (_, i) => entry(start + i + 1)), total };
      },
    });
  }

  test("ten rows a page, pagination arithmetic in footer and buttons", async () => {
    const seen: Record<string, unknown>[] = [];
    const reply = await jamEntries(
      entriesApi(305, seen),
      { jam: "brackeys-14", sort: "ratings", search: "cat" },
      ctx,
    );
    expect(seen[0]).toEqual({
      jamId: 1,
      page: 0,
      pageSize: ENTRIES_PAGE_SIZE,
      sortBy: "ratings",
      search: "cat",
    });
    const embed = reply.embeds[0]!;
    expect(embed.footer).toBe("Page 1/31 · 305 entries · by ratings");
    expect(embed.description?.split("\n")).toHaveLength(10);
    expect(embed.description).toContain(
      "**1.** [Game 1](https://itch.io/jam/brackeys-14/rate/1) — Author 1 · #1 · 3 ratings · from this server",
    );

    const [prev, next] = reply.buttons;
    expect(prev).toMatchObject({ kind: "page", disabled: true });
    expect(next).toMatchObject({ kind: "page", disabled: false });
    expect(decodeCustomId((next as { customId: string }).customId)).toEqual({
      kind: "jam_entries",
      jamId: 1,
      sort: "ratings",
      page: 1,
      search: "cat",
    });
  });

  test("a page turn decoded from a button renders the same shape after a 'restart'", async () => {
    // Nothing but the custom_id survives; the page handler re-reads the jam.
    const state = {
      kind: "jam_entries" as const,
      jamId: 1,
      sort: "rank" as const,
      page: 30,
      search: "",
    };
    const reply = await jamEntriesPage(entriesApi(305), state, ctx, true);
    const embed = reply.embeds[0]!;
    expect(embed.footer).toBe("Page 31/31 · 305 entries · by rank");
    expect(embed.description?.split("\n")).toHaveLength(5);
    expect(embed.description).toContain("**301.**");
    expect(reply.buttons[1]).toMatchObject({ kind: "page", disabled: true });
    expect(reply.ephemeral).toBe(true);
  });

  test("an empty search says so", async () => {
    const reply = await jamEntries(entriesApi(0), { jam: "brackeys-14", search: "zzz" }, ctx);
    expect(reply.embeds[0]?.description).toBe("No entries matching **zzz** yet.");
    expect(reply.outcome).toBe("hit");
  });

  test("stays under the 6000-character total with the longest titles in the archive", async () => {
    const long = "L".repeat(300);
    const api = fakeApi({
      getJam: async () => ({ jam: jam({ title: long }), trackedEntries: 10, hasResults: false }),
      listJamEntries: async () => ({
        entries: Array.from({ length: 10 }, (_, i) => ({
          ...entry(i + 1, long),
          authorName: long,
        })),
        total: 10,
      }),
    });
    const reply = await jamEntries(api, { jam: "brackeys-14" }, ctx);
    const embed = reply.embeds[0]!;
    expect(embedLength(embed)).toBeLessThan(EMBED_TOTAL_MAX);
    expect(embed.title!.length).toBeLessThanOrEqual(256);
  });
});

describe("/jam results", () => {
  test("answers from the phase when the API has none", async () => {
    const j = jam({ startDays: -10, endDays: -1, votingDays: 6 });
    const api = fakeApi({
      getJam: async () => ({ jam: j, trackedEntries: 10, hasResults: false }),
    });
    const reply = await jamResults(api, { jam: "brackeys-14" }, ctx);
    expect(reply.embeds[0]?.description).toBe(
      `**VOTING** · Results aren't in yet — voting ends <t:${unix(j.votingEndsAt!)}:R>.`,
    );
  });

  test("one field per criterion, Overall first, top 5", async () => {
    const place = (rank: number, title: string) => ({
      criterion: "",
      rank,
      score: 4.2,
      entryId: rank,
      gameTitle: title,
      gameUrl: null,
      gameCoverUrl: null,
      gameCoverColor: null,
      rateUrl: `/jam/brackeys-14/rate/${rank}`,
      authorName: "A",
      authorUrl: null,
    });
    const api = fakeApi({
      getJam: async () => ({ jam: jam(), trackedEntries: 10, hasResults: true }),
      getJamResults: async (input: { topN: number }) => {
        expect(input.topN).toBe(5);
        return {
          criteria: [
            {
              criterion: "Overall",
              entrantCount: 312,
              places: [place(1, "Winner"), place(2, "Second")],
            },
            { criterion: "Audio", entrantCount: 300, places: [place(1, "Loud")] },
          ],
        };
      },
    });
    const reply = await jamResults(api, { jam: "brackeys-14" }, ctx);
    const fields = reply.embeds[0]!.fields!;
    expect(fields.map((f) => f.name)).toEqual(["Overall · 312 ranked", "Audio · 300 ranked"]);
    expect(fields[0]!.value).toBe(
      "**#1** [Winner](https://itch.io/jam/brackeys-14/rate/1) — A\n**#2** [Second](https://itch.io/jam/brackeys-14/rate/2) — A",
    );
  });
});

test("timestamps never depend on the process zone", () => {
  const j = jam({ startDays: 0 });
  // Same instant, whichever zone renders it — only the unix seconds appear.
  expect(jamEmbed(j, ctx).fields?.[0]?.value).toBe(`<t:${unix(NOW)}:D>`);
});

import { describe, expect, test } from "bun:test";

import Anthropic from "@anthropic-ai/sdk";

import { DiscordBackoffError } from "../../../../src/lib/discord-guard.ts";
import { ctx, fakeApi } from "../../test/fake-api.ts";
import { classifyFailure, failureEmbed } from "../failure.ts";
import { EMBED_TOTAL_MAX, embedLength } from "../reply.ts";
import { ChannelUnreadableError } from "../summarize/history.ts";
import { SummaryRefusedError } from "../summarize/model.ts";
import type { PageSet, SummaryPages } from "../summarize/pages.ts";
import type { Summary } from "../summarize/summarizer.ts";
import { decodeCustomId } from "./custom-id.ts";
import { runInvocation, runPage } from "./dispatch.ts";
import { buildManifest, manifestOptions } from "./manifest.ts";
import type { ShareDecision } from "./share-gate.ts";
import {
  type Summarize,
  SummaryUnavailableError,
  summarizeChannel,
  summaryPageTurn,
} from "./summarize.ts";

const NOW = Date.parse("2026-10-26T15:30:00Z");

const summary = (fields: Partial<Summary> = {}): Summary => ({
  text: "**Serbia election**\n- CodeMyst reported the result.",
  from: NOW - 24 * 3_600_000,
  to: NOW,
  messageCount: 812,
  truncated: false,
  finalCached: false,
  buckets: { cached: 3, summarized: 2, raw: 4 },
  inputTokens: 9000,
  outputTokens: 600,
  costUsd: 0.0012,
  ...fields,
});

const input = { channelId: "243005537342586880", window: "24h" as const, share: false };

describe("summarizeChannel", () => {
  test("renders the summary with its span, size and a caveat", async () => {
    const reply = await summarizeChannel(async () => summary(), input);
    const [embed] = reply.embeds;
    expect(embed.title).toBe("Catch-up: the last 24h");
    expect(embed.description).toContain("Serbia election");
    expect(embed.footer).toBe(
      "812 messages · 10-25 15:30 – 10-26 15:30 UTC · AI summary, may miss things",
    );
    expect(reply.ephemeral).toBe(true);
  });

  test("says when it only covers the newest part of the window", async () => {
    const reply = await summarizeChannel(
      async () => summary({ truncated: true, messageCount: 3000 }),
      input,
    );
    expect(reply.embeds[0].footer).toStartWith("Newest 3,000 messages only");
  });

  const longText = Array.from(
    { length: 40 },
    (_, i) => `- point ${i} ${"word ".repeat(60)}[a link](https://discord.com/channels/1/2/3)`,
  ).join("\n");

  function memoryPages(): SummaryPages & { sets: Map<string, PageSet> } {
    const sets = new Map<string, PageSet>();
    return {
      sets,
      save: async (set) => {
        const token = `token${String(sets.size).padStart(7, "0")}`;
        sets.set(token, set);
        return token;
      },
      load: async (token) => sets.get(token) ?? null,
    };
  }

  test("a summary past one message is shown a page at a time, with buttons to turn them", async () => {
    const pages = memoryPages();
    const reply = await summarizeChannel(async () => summary({ text: longText }), input, { pages });
    const count = [...pages.sets.values()][0].pages.length;
    expect(count).toBeGreaterThan(2);
    expect(reply.embeds).toHaveLength(1);
    expect(embedLength(reply.embeds[0])).toBeLessThanOrEqual(EMBED_TOTAL_MAX);
    expect(reply.embeds[0].title).toBe("Catch-up: the last 24h");
    expect(reply.embeds[0].footer).toStartWith(`Page 1/${count} · 812 messages`);
    const [prev, next] = reply.buttons;
    expect(prev).toMatchObject({ kind: "page", disabled: true });
    expect(next).toMatchObject({ kind: "page", disabled: false });

    const state = decodeCustomId((next as { customId: string }).customId);
    expect(state).toMatchObject({ kind: "summary", page: 1 });
    const second = await runPage(fakeApi({}), state!, { ...ctx, summaryPages: pages }, true);
    expect(second.embeds[0].footer).toStartWith(`Page 2/${count} · `);
    expect(second.embeds[0].description).not.toBe(reply.embeds[0].description);
    expect(second.ephemeral).toBe(true);

    const last = await summaryPageTurn(pages, { ...state!, page: count - 1 } as never, false);
    expect(last.buttons[1]).toMatchObject({ disabled: true });
    expect(last.ephemeral).toBe(false);
  });

  test("a short summary has no pages, buttons or stored copy", async () => {
    const pages = memoryPages();
    const reply = await summarizeChannel(async () => summary(), input, { pages });
    expect(reply.buttons).toEqual([]);
    expect(reply.embeds[0].footer).toStartWith("812 messages");
    expect(pages.sets.size).toBe(0);
  });

  test("with nowhere to keep the rest it shows the first page and says so", async () => {
    const reply = await summarizeChannel(async () => summary({ text: longText }), input);
    expect(reply.embeds).toHaveLength(1);
    expect(reply.buttons).toEqual([]);
    expect(reply.embeds[0].footer).toContain("the rest couldn't be kept");
  });

  test("a page turn on a copy that is gone asks for a fresh run", async () => {
    await expect(
      summaryPageTurn(memoryPages(), { token: "missing00000", page: 1 }, true),
    ).rejects.toMatchObject({ reason: "expired" });
    await expect(
      summaryPageTurn(undefined, { token: "missing00000", page: 1 }, true),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  test("the ceiling follows where the reply goes", async () => {
    const seen: (boolean | undefined)[] = [];
    const summarize: Summarize = async (_c, _w, { shared }) => {
      seen.push(shared);
      return summary();
    };
    await summarizeChannel(summarize, input);
    await summarizeChannel(summarize, { ...input, share: true });
    expect(seen).toEqual([false, true]);
  });

  test("a question becomes the title and is passed through", async () => {
    let seen: string | undefined;
    const reply = await summarizeChannel(
      async (_c, _w, { question }) => {
        seen = question;
        return summary({ text: "Job argued for voting." });
      },
      { ...input, question: "who argued for voting?" },
    );
    expect(seen).toBe("who argued for voting?");
    expect(reply.embeds[0].title).toBe("“who argued for voting?”");
    expect(reply.embeds[0].description).toBe("Job argued for voting.");
  });

  test("since I last posted: titled for it, or for the 7-day cap when there was none", async () => {
    const mine = { ...input, window: "mine" as const };
    const found = await summarizeChannel(async () => summary({ sinceLastPost: true }), mine);
    expect(found.embeds[0].title).toBe("Catch-up: since you last posted");
    const none = await summarizeChannel(async () => summary({ sinceLastPost: false }), mine);
    expect(none.embeds[0].title).toBe("Catch-up: the last 7 days");
    expect(none.embeds[0].footer).toContain("You haven't posted here in the last 7 days");
    const quiet = await summarizeChannel(
      async () => summary({ text: "", sinceLastPost: true }),
      mine,
    );
    expect(quiet.content).toBe("Nothing new here since you last posted.");
  });

  test("an empty window is a plain line", async () => {
    const reply = await summarizeChannel(async () => summary({ text: "" }), input);
    expect(reply.outcome).toBe("not_found");
    expect(reply.content).toBe("Nothing was said here in the last 24h.");
  });

  test("share posts it", async () => {
    const reply = await summarizeChannel(async () => summary(), { ...input, share: true });
    expect(reply.ephemeral).toBe(false);
  });

  const failing =
    (error: unknown): Summarize =>
    async () => {
      throw error;
    };
  const reasonOf = async (error: unknown) => {
    try {
      await summarizeChannel(failing(error), input);
    } catch (thrown) {
      return thrown instanceof SummaryUnavailableError ? thrown.reason : thrown;
    }
    throw new Error("expected a throw");
  };

  test("maps expected failures to a reason the member can act on", async () => {
    expect(await reasonOf(new ChannelUnreadableError("1", 403))).toBe("unreadable");
    expect(await reasonOf(new DiscordBackoffError(NOW))).toBe("busy");
    expect(await reasonOf(new SummaryRefusedError())).toBe("refused");
    expect(
      await reasonOf(new Anthropic.RateLimitError(429, undefined, "slow down", new Headers())),
    ).toBe("busy");
    expect(
      await reasonOf(
        new Anthropic.InternalServerError(529, undefined, "overloaded", new Headers()),
      ),
    ).toBe("busy");
  });

  test("anything else stays a bug", async () => {
    const bug = new TypeError("oops");
    expect(await reasonOf(bug)).toBe(bug);
  });

  test("gives up waiting after the timeout", async () => {
    const never: Summarize = () => new Promise(() => {});
    await expect(summarizeChannel(never, input, { timeoutMs: 5 })).rejects.toMatchObject({
      reason: "slow",
    });
  });

  test("the failure embed shows the summary's own line", () => {
    const failure = classifyFailure(
      new SummaryUnavailableError("busy", "The summarizer is busy right now."),
    );
    expect(failure).toMatchObject({ kind: "throttled", code: "summary busy" });
    const embed = failureEmbed(failure, { appUrl: ctx.appUrl, label: "summarize" });
    expect(embed.description).toBe("The summarizer is busy right now.");
  });
});

describe("dispatch", () => {
  test("defaults the window and summarizes the channel the command ran in", async () => {
    const seen: [string, string][] = [];
    await runInvocation(
      fakeApi({}),
      { command: "summarize", options: {}, channelId: "42" },
      {
        ...ctx,
        summarize: async (channelId, window) => {
          seen.push([channelId, window]);
          return summary();
        },
      },
    );
    expect(seen).toEqual([["42", "24h"]]);
  });

  test("passes the caller for since-my-last-message", async () => {
    let seen: unknown;
    await runInvocation(
      fakeApi({}),
      {
        command: "summarize",
        options: { since: "mine" },
        channelId: "42",
        actorId: "7",
        actorName: "Jo",
      },
      {
        ...ctx,
        summarize: async (_c, window, options) => {
          seen = { window, ...options };
          return summary();
        },
      },
    );
    expect(seen).toEqual({
      window: "mine",
      question: undefined,
      requesterId: "7",
      requesterName: "Jo",
      shared: false,
    });
  });

  test("a share the gate refused is private, so it gets the private ceiling", async () => {
    const seen: (boolean | undefined)[] = [];
    const run = (decision?: ShareDecision) =>
      runInvocation(
        fakeApi({}),
        { command: "summarize", options: { share: true }, channelId: "42" },
        {
          ...ctx,
          summarize: async (_c, _w, { shared }) => {
            seen.push(shared);
            return summary();
          },
        },
        decision,
      );
    await run({ shared: true, denied: false });
    await run({ shared: false, denied: true, notice: "Sharing is for #bot." });
    expect(seen).toEqual([true, false]);
  });

  test("passes a trimmed question, and none for a blank one", async () => {
    const asked: (string | undefined)[] = [];
    const run = (ask: string) =>
      runInvocation(
        fakeApi({}),
        { command: "summarize", options: { ask }, channelId: "42" },
        {
          ...ctx,
          summarize: async (_c, _w, { question }) => {
            asked.push(question);
            return summary();
          },
        },
      );
    await run("  what happened?  ");
    await run("   ");
    expect(asked).toEqual(["what happened?", undefined]);
  });

  test("answers a line when summaries aren't configured", async () => {
    const reply = await runInvocation(
      fakeApi({}),
      { command: "summarize", options: {}, channelId: "42" },
      ctx,
    );
    expect(reply.content).toContain("aren't switched on");
  });
});

describe("manifest", () => {
  const find = (commands: ReturnType<typeof buildManifest>) =>
    commands.find((c) => c.name === "summarize");

  test("registers /summarize only when the bot can run it", () => {
    expect(find(buildManifest("jams.team"))).toBeUndefined();
    expect(
      manifestOptions({ REDIS_URL: "redis://x", SUMMARIZE_OPEN: false }).summarize,
    ).toBeUndefined();
  });

  test("is staff-only unless opened", () => {
    const staff = find(
      buildManifest(
        "jams.team",
        manifestOptions({ REDIS_URL: "redis://x", ANTHROPIC_API_KEY: "k", SUMMARIZE_OPEN: false }),
      ),
    );
    expect(staff?.default_member_permissions).toBe("8192");
    const open = find(buildManifest("jams.team", { summarize: { staffOnly: false } }));
    expect(open?.default_member_permissions).toBeUndefined();
    expect(open?.options?.map((o) => o.name)).toEqual(["since", "ask", "share"]);
    const since = open?.options?.find((o) => o.name === "since") as
      | { choices?: { value: string }[] }
      | undefined;
    expect(since?.choices?.map((c) => c.value)).toContain("mine");
  });
});

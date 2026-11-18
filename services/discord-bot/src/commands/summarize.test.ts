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
    expect(embed.description).toEndWith("Covers <t:1792942200:f> – <t:1793028600:f>");
    expect(embed.footer).toBe("812 messages · AI summary, may miss things");
    expect(reply.ephemeral).toBe(true);
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

  test("a shared summary that fits is one unbroken embed", async () => {
    const pages = memoryPages();
    const text = "- a point\n".repeat(300);
    const reply = await summarizeChannel(
      async () => summary({ text }),
      { ...input, share: true },
      {
        pages,
      },
    );
    expect(reply.more).toBeUndefined();
    expect(reply.buttons).toHaveLength(0);
    expect(reply.embeds).toHaveLength(1);
    expect(reply.embeds[0].description).toStartWith(text.trim());
    expect(reply.embeds[0].description).toEndWith("Covers <t:1792942200:f> – <t:1793028600:f>");
    expect(reply.embeds[0].footer).toStartWith("812 messages");
    expect(pages.sets.size).toBe(0);
  });

  test("a shared summary too long for one embed is consecutive messages, never pages", async () => {
    const pages = memoryPages();
    const reply = await summarizeChannel(
      async () => summary({ text: longText }),
      { ...input, share: true },
      { pages },
    );
    const all = [reply, ...(reply.more ?? [])];
    expect(all.length).toBeGreaterThan(1);
    expect(pages.sets.size).toBe(0);
    for (const [i, part] of all.entries()) {
      expect(part.buttons).toHaveLength(0);
      expect(part.ephemeral).toBe(false);
      expect(part.embeds.at(-1)!.footer).toStartWith(`Part ${i + 1}/${all.length} · 812 messages`);
      const total = part.embeds.reduce((sum, embed) => sum + embedLength(embed), 0);
      expect(total).toBeLessThanOrEqual(EMBED_TOTAL_MAX);
    }
    // A message carries a second embed before the answer spills into another message.
    expect(all[0].embeds.length).toBeGreaterThan(1);
    expect(all[0].embeds[0].title).toBe("Catch-up: the last 24h");
    expect(all[1].embeds[0].title).toBeUndefined();
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
    expect(reply.embeds[0].description).toStartWith("Job argued for voting.\n\nCovers <t:");
  });

  test("since I last posted: titled for it, or for the 7-day cap when there was none", async () => {
    const mine = { ...input, window: "mine" as const };
    const found = await summarizeChannel(async () => summary({ sinceLastPost: true }), mine);
    expect(found.embeds[0].title).toBe("Catch-up: since you last posted");
    const none = await summarizeChannel(async () => summary({ sinceLastPost: false }), mine);
    expect(none.embeds[0].title).toBe("Catch-up: the last 7 days");
    expect(none.embeds[0].footer).toContain("You haven't posted here in the last 7 days");
    const quiet = await summarizeChannel(
      async () => summary({ text: "", messageCount: 0, sinceLastPost: true }),
      mine,
    );
    expect(quiet.content).toBe("Nothing new here since you last posted.");
  });

  test("an empty window is a plain line", async () => {
    const reply = await summarizeChannel(async () => summary({ text: "", messageCount: 0 }), input);
    expect(reply.outcome).toBe("not_found");
    expect(reply.content).toBe("Nothing was said here in the last 24h.");
  });

  test("an empty summary of a busy window is a failure, not a quiet channel", async () => {
    await expect(summarizeChannel(async () => summary({ text: "" }), input)).rejects.toThrow();
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

  const slowly =
    (result: () => Summary | Promise<never>, ms = 20): Summarize =>
    () =>
      new Promise((resolve, reject) =>
        setTimeout(() => Promise.resolve(result()).then(resolve, reject), ms),
      );

  test("a quick summary is the reply itself", async () => {
    const reply = await summarizeChannel(
      slowly(() => summary(), 1),
      input,
      { patienceMs: 50 },
    );
    expect(reply.outcome).toBe("hit");
    expect(reply.later).toBeUndefined();
  });

  test("past the patience window the reply is a note and the summary comes later", async () => {
    const reply = await summarizeChannel(
      slowly(() => summary()),
      input,
      { patienceMs: 5 },
    );
    expect(reply.outcome).toBe("pending");
    expect(reply.embeds).toHaveLength(0);
    expect(reply.content).toContain("as a new message");
    const late = await reply.later!;
    expect(late.outcome).toBe("hit");
    expect(late.embeds[0].title).toBe("Catch-up: the last 24h");
  });

  test("a shared note says the summary will be posted here", async () => {
    const reply = await summarizeChannel(
      slowly(() => summary()),
      { ...input, share: true },
      {
        patienceMs: 5,
      },
    );
    expect(reply.ephemeral).toBe(false);
    expect(reply.content).toContain("posted here");
    expect((await reply.later!).ephemeral).toBe(false);
  });

  test("a failure after the note arrives through later, translated", async () => {
    const reply = await summarizeChannel(
      slowly(() => Promise.reject(new DiscordBackoffError(Date.now() + 1000))),
      input,
      { patienceMs: 5 },
    );
    expect(reply.outcome).toBe("pending");
    await expect(reply.later!).rejects.toMatchObject({ reason: "busy" });
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

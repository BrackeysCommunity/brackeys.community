import { describe, expect, test } from "bun:test";

import Anthropic from "@anthropic-ai/sdk";

import { DiscordBackoffError } from "../../../../src/lib/discord-guard.ts";
import { ctx, fakeApi } from "../../test/fake-api.ts";
import { classifyFailure, failureEmbed } from "../failure.ts";
import { ChannelUnreadableError } from "../summarize/history.ts";
import { SummaryRefusedError } from "../summarize/model.ts";
import type { Summary } from "../summarize/summarizer.ts";
import { runInvocation } from "./dispatch.ts";
import { buildManifest, manifestOptions } from "./manifest.ts";
import {
  type Summarize,
  SummaryUnavailableError,
  splitSummary,
  summarizeChannel,
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

  test("a summary past one embed's limit continues in a second, footer on the last", async () => {
    const line = `- ${"word ".repeat(60)}[a link](https://discord.com/channels/1/2/3)`;
    const text = Array.from({ length: 14 }, () => line).join("\n");
    expect(text.length).toBeGreaterThan(4096);
    const reply = await summarizeChannel(async () => summary({ text }), input);
    expect(reply.embeds).toHaveLength(2);
    expect(reply.embeds[0].title).toBe("Catch-up: the last 24h");
    expect(reply.embeds[0].footer).toBeUndefined();
    expect(reply.embeds[1].footer).toContain("AI summary");
    expect(reply.embeds.map((e) => e.description).join("\n")).toBe(text);
    for (const e of reply.embeds) expect(e.description!.length).toBeLessThanOrEqual(4096);
  });

  test("splitSummary cuts at a line break", () => {
    expect(splitSummary("aaa\nbbb\nccc", 8)).toEqual(["aaa\nbbb", "ccc"]);
    expect(splitSummary("short", 8)).toEqual(["short"]);
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
    await expect(summarizeChannel(never, input, 5)).rejects.toMatchObject({ reason: "slow" });
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
    expect(open?.options?.map((o) => o.name)).toEqual(["since", "share"]);
  });
});

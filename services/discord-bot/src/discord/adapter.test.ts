import { expect, test } from "bun:test";

import { MessageFlags } from "discord.js";

import { SummaryUnavailableError } from "../commands/summarize.ts";
import type { Reply } from "../reply.ts";
import { commandCooldownLine, deliverLate } from "./adapter.ts";

test("a command's own cooldown line states the allowance and the wait", () => {
  const rule = { limit: 10, windowMs: 10 * 60_000 };
  expect(commandCooldownLine(4 * 60_000 + 1, rule)).toBe(
    "That's the limit of 10 uses per 10 minutes. Try again in 5 minutes.",
  );
  expect(commandCooldownLine(20_000, { limit: 2, windowMs: 60_000 })).toBe(
    "That's the limit of 2 uses per minute. Try again in a minute.",
  );
});

const answer: Reply = {
  embeds: [{ title: "Catch-up: the last 24h", description: "- a point" }],
  buttons: [],
  ephemeral: false,
  outcome: "hit",
};

type LateTarget = Parameters<typeof deliverLate>[1];
type Sent = { title?: string; content: string; ephemeral: boolean };

const sent = (message: { embeds?: unknown; content?: string }, ephemeral: boolean): Sent => ({
  title: (message.embeds as { title?: string }[] | undefined)?.[0]?.title,
  content: message.content ?? "",
  ephemeral,
});

function lateTarget(visibility: "public" | "ephemeral", { followUpFails = false } = {}) {
  const followUps: Sent[] = [];
  const direct: Sent[] = [];
  const target: LateTarget = {
    visibility,
    label: "summarize",
    appUrl: "https://example.test",
    log: () => {},
    followUp: async (message) => {
      if (followUpFails) throw new Error("Invalid Webhook Token");
      followUps.push(sent(message, message.flags === MessageFlags.Ephemeral));
    },
    sendDirect: async (message, ephemeral) => {
      direct.push(sent(message, ephemeral));
    },
  };
  return { target, followUps, direct };
}

test("a late answer is a new follow-up message with the reply's visibility", async () => {
  const { target, followUps, direct } = lateTarget("public");
  await deliverLate(Promise.resolve(answer), target);
  expect(followUps).toEqual([{ title: "Catch-up: the last 24h", content: "", ephemeral: false }]);
  expect(direct).toHaveLength(0);
});

test("past the interaction token it posts directly: the channel when shared, a DM when private", async () => {
  const shared = lateTarget("public", { followUpFails: true });
  await deliverLate(Promise.resolve(answer), shared.target);
  expect(shared.direct).toEqual([
    { title: "Catch-up: the last 24h", content: "", ephemeral: false },
  ]);

  const mine = lateTarget("ephemeral", { followUpFails: true });
  await deliverLate(Promise.resolve(answer), mine.target);
  expect(mine.direct[0].ephemeral).toBe(true);
});

test("a late failure is told privately, even for a shared summary", async () => {
  const { target, followUps } = lateTarget("public");
  await deliverLate(
    Promise.reject(new SummaryUnavailableError("busy", "The summarizer is busy right now.")),
    target,
  );
  expect(followUps).toHaveLength(1);
  expect(followUps[0].ephemeral).toBe(true);
  expect(followUps[0].title).not.toBe("Catch-up: the last 24h");
});

test("a late shared answer posts every part, in order", async () => {
  const { target, followUps } = lateTarget("public");
  const part = (title: string): Reply => ({ ...answer, embeds: [{ title, description: "-" }] });
  await deliverLate(
    Promise.resolve({ ...part("one"), more: [part("two"), part("three")] }),
    target,
  );
  expect(followUps.map((m) => m.title)).toEqual(["one", "two", "three"]);
});

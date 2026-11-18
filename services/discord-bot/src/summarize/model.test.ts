import { describe, expect, test } from "bun:test";

import {
  EmptySummaryError,
  type ModelResponse,
  replyWithin,
  SummaryRefusedError,
} from "./model.ts";

const response = (stop: string, text = ""): ModelResponse => ({
  stop_reason: stop,
  content: [{ type: "thinking" }, ...(text ? [{ type: "text", text }] : [])],
  usage: { input_tokens: 100, output_tokens: 10 },
});

function scripted(...replies: ModelResponse[]) {
  const efforts: string[] = [];
  const send = async (effort: string) => {
    efforts.push(effort);
    return replies[efforts.length - 1];
  };
  return { send, efforts };
}

describe("replyWithin", () => {
  test("a reply that fits is taken as is", async () => {
    const { send, efforts } = scripted(response("end_turn", "done"));
    expect(await replyWithin(send, "high")).toEqual({
      text: "done",
      usage: { inputTokens: 100, outputTokens: 10 },
      complete: true,
    });
    expect(efforts).toEqual(["high"]);
  });

  test("out of room, it retries thinking less, and counts every attempt", async () => {
    const { send, efforts } = scripted(
      response("max_tokens"),
      response("max_tokens", "half a"),
      response("end_turn", "the summary"),
    );
    const reply = await replyWithin(send, "high");
    expect(efforts).toEqual(["high", "medium", "low"]);
    expect(reply).toMatchObject({ text: "the summary", complete: true });
    expect(reply.usage).toEqual({ inputTokens: 300, outputTokens: 30 });
  });

  test("cut off at the lowest effort, the partial reply comes back marked incomplete", async () => {
    const { send } = scripted(response("max_tokens", "half a"));
    expect(await replyWithin(send, "low")).toMatchObject({ text: "half a", complete: false });
  });

  test("nothing written even at the lowest effort is an error, never an empty summary", async () => {
    const { send } = scripted(response("max_tokens"), response("max_tokens"));
    await expect(replyWithin(send, "medium")).rejects.toBeInstanceOf(EmptySummaryError);
  });

  test("a refusal is not retried", async () => {
    const { send, efforts } = scripted(response("refusal"));
    await expect(replyWithin(send, "high")).rejects.toBeInstanceOf(SummaryRefusedError);
    expect(efforts).toEqual(["high"]);
  });
});

import { describe, expect, it } from "vite-plus/test";

import { deleteDiscordMessage } from "@/lib/discord-message-delete";

function fetchReturning(status: number, body = "") {
  const seen: { url: string; init: unknown }[] = [];
  const impl = async (url: string, init: unknown) => {
    seen.push({ url, init });
    // 204 is what Discord actually answers, and the Response constructor
    // refuses a body with it.
    return new Response(status === 204 ? null : body, { status });
  };
  return { seen, impl: impl as Parameters<typeof deleteDiscordMessage>[0]["fetchImpl"] };
}

const params = { botToken: "bot-token", channelId: "9001", messageId: "42" };

describe("deleteDiscordMessage", () => {
  it("deletes the message in the channel the caller names", async () => {
    const { seen, impl } = fetchReturning(204);
    expect(await deleteDiscordMessage({ ...params, fetchImpl: impl })).toBe("deleted");
    expect(seen[0].url).toBe("https://discord.com/api/v10/channels/9001/messages/42");
    expect(seen[0].init).toMatchObject({
      method: "DELETE",
      headers: { Authorization: "Bot bot-token" },
    });
  });

  it("treats an already-deleted message as the outcome it wanted", async () => {
    const { impl } = fetchReturning(404);
    expect(await deleteDiscordMessage({ ...params, fetchImpl: impl })).toBe("gone");
  });

  it("throws on a refusal, so the caller can retry on the next sweep", async () => {
    const { impl } = fetchReturning(403, "Missing Permissions");
    await expect(deleteDiscordMessage({ ...params, fetchImpl: impl })).rejects.toThrow(/403/);
  });
});

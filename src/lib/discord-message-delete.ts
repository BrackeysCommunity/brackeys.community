/**
 * Deleting one message the bot posted, and nothing else.
 *
 * Deliberately dependency-free — no `@/` imports, no Redis, no config
 * module — because it is copied into `services/notifications-worker`'s
 * image, where a value import of the app's aliases would crash-loop the
 * deploy. The whole surface is a bot token, two ids and one DELETE.
 *
 * That narrowness is also why the worker can be trusted with it: the
 * lifecycle sweep needs to take a mirror down when a post expires, and
 * this hands it exactly that ability and no other reach into the guild.
 */

export type DeleteMessageOutcome = "deleted" | "gone";

/** The shape of `fetch` this needs — and of the web app's guarded funnel. */
export type MessageFetch = (
  url: string,
  init: { method: "DELETE"; headers: Record<string, string> },
) => Promise<Response>;

export async function deleteDiscordMessage(params: {
  botToken: string;
  channelId: string;
  messageId: string;
  /**
   * The web app passes `discordWriteFetch` so the delete shares its
   * rate-limit backoff window; the worker passes nothing and gets plain
   * `fetch`, which is right for a handful of deletes an hour.
   */
  fetchImpl?: MessageFetch;
}): Promise<DeleteMessageOutcome> {
  const send: MessageFetch =
    params.fetchImpl ?? ((url, init) => fetch(url, init as unknown as RequestInit));
  const response = await send(
    `https://discord.com/api/v10/channels/${params.channelId}/messages/${params.messageId}`,
    { method: "DELETE", headers: { Authorization: `Bot ${params.botToken}` } },
  );
  // Already gone is the outcome we wanted, not a failure to report.
  if (response.status === 404) return "gone";
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Discord refused to delete the message: ${response.status} ${body.slice(0, 200)}`,
    );
  }
  return "deleted";
}

import type { DiscordApiMessage } from "./history.ts";
import type { RefTable } from "./refs.ts";

export interface TranscriptMessage {
  id: string;
  at: number;
  author: string;
  text: string;
}

/** Plain messages and replies; joins, pins, boosts and the like say nothing to summarize. */
const SPOKEN_TYPES = new Set([0, 19]);

const displayName = (user: { username: string; global_name?: string | null }) =>
  user.global_name || user.username;

/**
 * One message as the model reads it. Mentions become `@name` so the model
 * never sees (or echoes back) a raw `<@id>`, custom emojis become `:name:`,
 * and attachments are named rather than described.
 */
export function toTranscript(message: DiscordApiMessage): TranscriptMessage | null {
  if (!SPOKEN_TYPES.has(message.type)) return null;
  const names = new Map((message.mentions ?? []).map((user) => [user.id, displayName(user)]));
  let text = message.content
    .replace(/<@!?(\d+)>/g, (_, id: string) => `@${names.get(id) ?? "someone"}`)
    .replace(/<a?:(\w+):\d+>/g, ":$1:");
  const extras: string[] = (message.attachments ?? []).map((a) =>
    a.content_type?.startsWith("image/") ? "[image]" : "[file]",
  );
  if (message.sticker_items?.length) extras.push("[sticker]");
  text = [text.trim(), ...extras].filter(Boolean).join(" ");
  if (!text) return null;
  const replyTo = message.referenced_message?.author;
  return {
    id: message.id,
    at: Date.parse(message.timestamp),
    author: displayName(message.author),
    text: replyTo ? `(replying to ${displayName(replyTo)}) ${text}` : text,
  };
}

export function formatStamp(ms: number): string {
  return new Date(ms).toISOString().slice(5, 16).replace("T", " ");
}

/** One line per message, numbered for citation when a table is given. */
export function formatLines(messages: TranscriptMessage[], refs?: RefTable): string {
  return messages
    .map((m) => {
      const line = `[${formatStamp(m.at)}] ${m.author}: ${m.text}`;
      return refs ? `#${refs.number(m.id)} ${line}` : line;
    })
    .join("\n");
}

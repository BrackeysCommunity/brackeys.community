export type TriggerKind = "emoji" | "mention" | "channel";

export interface TriggerMatch {
  kind: TriggerKind;
  query: string;
  /** Index of the trigger character; the replacement spans `start` to the caret. */
  start: number;
}

// All need a boundary before the trigger, so `12:30`, `http://`,
// `me@mail.com` and `page#anchor` never open a picker. A channel needs a
// letter right after `#`, so a `# heading` doesn't either.
const EMOJI_TRIGGER = /(^|[\s([{])(:)([\w+-]{2,32})$/;
const MENTION_TRIGGER = /(^|[^\w@/.])(@)([a-z0-9_-]{2,31})$/i;
const CHANNEL_TRIGGER = /(^|[\s([{])(#)([\w-]{1,32})$/;

/** The `:name`, `@handle` or `#channel` being typed at `caret`, if any. */
export function findTrigger(text: string, caret: number): TriggerMatch | null {
  const before = text.slice(0, caret);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  // Inside an inline code span the text is quoted, not written.
  if ((line.split("`").length - 1) % 2 === 1) return null;

  for (const [kind, pattern] of [
    ["emoji", EMOJI_TRIGGER],
    ["mention", MENTION_TRIGGER],
    ["channel", CHANNEL_TRIGGER],
  ] as const) {
    const match = pattern.exec(before);
    if (match) {
      return { kind, query: match[3]!, start: match.index + match[1]!.length };
    }
  }
  return null;
}

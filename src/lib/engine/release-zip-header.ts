// The zip route's itch.io layout header, written by the route and read by the
// game page; no server imports, so the page's bundle can take it.
import type { SceneIssue } from "@jams/engine/scene";

/** The response header carrying `itchIssuesHeader`'s summary. */
export const ITCH_ISSUES_HEADER = "x-jams-itch-issues";

const HEADER_MESSAGES = 10;
const HEADER_MESSAGE_CHARS = 200;

/**
 * `ITCH_ISSUES_HEADER`'s value: `{ count, messages }` as JSON with every
 * character outside printable ASCII escaped, so it's a legal header and
 * `JSON.parse` reads it back. Messages are capped; `count` is every issue.
 */
export function itchIssuesHeader(issues: readonly SceneIssue[]): string {
  const messages = issues
    .slice(0, HEADER_MESSAGES)
    .map((issue) =>
      issue.message.length > HEADER_MESSAGE_CHARS
        ? `${issue.message.slice(0, HEADER_MESSAGE_CHARS - 1)}…`
        : issue.message,
    );
  return JSON.stringify({ count: issues.length, messages }).replace(
    /[^\x20-\x7e]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** What the game page shows from a zip response's `ITCH_ISSUES_HEADER`; null when it has none or it's malformed. */
export function readItchIssuesHeader(
  value: string | null,
): { count: number; messages: string[] } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "count" in parsed &&
      "messages" in parsed &&
      typeof parsed.count === "number" &&
      Array.isArray(parsed.messages) &&
      parsed.messages.every((m) => typeof m === "string")
    )
      return { count: parsed.count, messages: parsed.messages as string[] };
  } catch {
    // Not ours; the page shows nothing.
  }
  return null;
}

import { describe, expect, test } from "bun:test";

import type { DiscordApiMessage } from "./history.ts";
import { formatLines, resolveTimes, toTranscript } from "./transcript.ts";

const base: DiscordApiMessage = {
  id: "1300000000000000000",
  type: 0,
  content: "",
  timestamp: "2026-10-26T15:04:00.000Z",
  author: { id: "1", username: "jo_handle", global_name: "Jo" },
};

describe("toTranscript", () => {
  test("names mentions and emojis instead of passing raw tokens", () => {
    const line = toTranscript({
      ...base,
      content: "hey <@2> and <@!3> <:kekw:706561487346335806> <a:spin:1>",
      mentions: [
        { id: "2", username: "sam", global_name: "Sam" },
        { id: "3", username: "riley" },
      ],
    });
    expect(line?.text).toBe("hey @Sam and @riley :kekw: :spin:");
    expect(line?.author).toBe("Jo");
  });

  test("names attachments and stickers, and keeps attachment-only messages", () => {
    const line = toTranscript({
      ...base,
      attachments: [{ content_type: "image/png" }, { content_type: "application/zip" }],
      sticker_items: [{}],
    });
    expect(line?.text).toBe("[image] [file] [sticker]");
  });

  test("marks who a reply answers", () => {
    const line = toTranscript({
      ...base,
      type: 19,
      content: "yes",
      referenced_message: { author: { username: "sam", global_name: "Sam" } },
    });
    expect(line?.text).toBe("(replying to Sam) yes");
  });

  test("drops system messages and empty ones", () => {
    expect(toTranscript({ ...base, type: 7, content: "joined" })).toBeNull();
    expect(toTranscript({ ...base, content: "   " })).toBeNull();
  });
});

test("formatLines stamps each line in UTC", () => {
  const line = toTranscript({ ...base, content: "hi" })!;
  expect(formatLines([line])).toBe("[10-26 15:04] Jo: hi");
});

describe("resolveTimes", () => {
  const unix = (iso: string) => Date.parse(iso) / 1000;
  const now = Date.parse("2026-10-26T15:30:00Z");

  test("the last day shows the time alone, further back the date with it", () => {
    expect(resolveTimes("at {10-26 15:04}, after {10-21 09:00}", now)).toBe(
      `at <t:${unix("2026-10-26T15:04:00Z")}:t>, after <t:${unix("2026-10-21T09:00:00Z")}:f>`,
    );
  });

  test("a stamp from before the new year is not read as next December", () => {
    const january = Date.parse("2027-01-02T08:00:00Z");
    expect(resolveTimes("{12-30 22:15}", january)).toBe(`<t:${unix("2026-12-30T22:15:00Z")}:f>`);
  });

  test("a stamp that is no real time stays readable, and other braces are left alone", () => {
    expect(resolveTimes("{13-40 25:61} and {not a stamp}", now)).toBe(
      "13-40 25:61 UTC and {not a stamp}",
    );
  });
});

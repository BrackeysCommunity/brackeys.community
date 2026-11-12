import { describe, expect, it } from "bun:test";

import {
  ENGINE_RELEASE_NOTICE_CHANNEL,
  parseEngineReleaseNotice,
} from "../../../src/lib/image-quarantine.ts";
import { releaseNoticePublisher } from "./release-notice.ts";

describe("releaseNoticePublisher", () => {
  it("publishes the notice the web app's frame cache parses", async () => {
    const sent: [string, string][] = [];
    const announce = releaseNoticePublisher({
      publish: async (channel, message) => void sent.push([channel, message]),
    });
    await announce({ releaseIds: ["a".repeat(64)], projectIds: [] });

    expect(sent).toHaveLength(1);
    const [channel, message] = sent[0]!;
    expect(channel).toBe(ENGINE_RELEASE_NOTICE_CHANNEL);
    expect(parseEngineReleaseNotice(message)).toEqual({
      releaseIds: ["a".repeat(64)],
      projectIds: [],
    });
  });
});

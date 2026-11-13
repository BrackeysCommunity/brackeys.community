import { liveCompat, liveCompatKey } from "@jams/engine/project";
import { describe, expect, it } from "vite-plus/test";

import { plannedRelease } from "../../src/lib/engine/__tests__/release-fixture";
import { compatKeyOf, planLiveCompatBackfill } from "../engine/backfill-live-compat";

const hex = (c: string) => c.repeat(64);

describe("the live compat backfill", () => {
  it("gives a stored manifest its key, and a collected or broken one ''", async () => {
    const release = await plannedRelease();
    const key = await liveCompatKey(liveCompat(release.manifest));
    expect(await compatKeyOf({ manifest: release.text, collectedAt: null })).toEqual({ key });
    expect(await compatKeyOf({ manifest: null, collectedAt: new Date() })).toEqual({
      key: "",
      reason: "collected",
    });
    expect(await compatKeyOf({ manifest: release.text, collectedAt: new Date() })).toEqual({
      key: "",
      reason: "collected",
    });
    expect(await compatKeyOf({ manifest: "{", collectedAt: null })).toEqual({
      key: "",
      reason: "unparsable",
    });
  });

  it("updates only rows whose key differs, and gives two builds of one game the same key", async () => {
    const first = await plannedRelease();
    const second = await plannedRelease({ hallVariant: 2 });
    expect(second.releaseId).not.toBe(first.releaseId);
    const key = await liveCompatKey(liveCompat(first.manifest));

    const plan = await planLiveCompatBackfill([
      { id: hex("1"), manifest: first.text, collectedAt: null, liveCompatKey: "" },
      { id: hex("2"), manifest: second.text, collectedAt: null, liveCompatKey: "" },
      { id: hex("3"), manifest: first.text, collectedAt: null, liveCompatKey: key },
      { id: hex("4"), manifest: null, collectedAt: new Date(), liveCompatKey: "" },
      { id: hex("5"), manifest: null, collectedAt: new Date(), liveCompatKey: key },
    ]);
    expect(plan.updates).toEqual([
      { id: hex("1"), liveCompatKey: key },
      { id: hex("2"), liveCompatKey: key },
      { id: hex("5"), liveCompatKey: "" },
    ]);
    expect(plan.current).toBe(2);
    expect(plan.empty).toEqual([
      { id: hex("4"), reason: "collected" },
      { id: hex("5"), reason: "collected" },
    ]);
    // Run again over its own result: nothing left to do.
    const again = await planLiveCompatBackfill([
      { id: hex("1"), manifest: first.text, collectedAt: null, liveCompatKey: key },
    ]);
    expect(again).toEqual({ updates: [], empty: [], current: 1 });
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  blobsDue,
  collectionForecast,
  nextCollectorRun,
  releasesToCollect,
  reportsDue,
  savesDue,
  sceneVersionForecast,
  sceneVersionsToCollect,
  type ReleaseRow,
  type SceneVersionRow,
} from "../collect-plan";
import {
  BLOB_GRACE_DAYS,
  LIVE_LIMITS,
  LIVE_REPORT_RETENTION_DAYS,
  PROJECT_QUOTA,
  RELEASE_GRACE_DAYS,
  SITE_SAVE_EXPIRY_DAYS,
} from "../limits";

const DAY = 86_400_000;
const NOW = new Date("2026-11-12T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const NONE = { channels: [], jams: [] };

/** `count` releases, v1 oldest, one a day ending today. */
function releases(count: number, ageOfNewest = 0): ReleaseRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i + 1}`,
    version: i + 1,
    createdAt: daysAgo(ageOfNewest + count - 1 - i),
    collectedAt: null,
  }));
}

describe("releasesToCollect", () => {
  it("keeps the newest releases", () => {
    expect(releasesToCollect(releases(PROJECT_QUOTA.releasesKept, 100), NONE, NOW)).toEqual([]);
  });

  it("collects what is beyond the kept set and past the grace, oldest first", () => {
    const rows = releases(PROJECT_QUOTA.releasesKept + 3, 100);
    expect(releasesToCollect(rows, NONE, NOW)).toEqual(["r1", "r2", "r3"]);
  });

  it("never collects a release a channel or a jam pins", () => {
    const rows = releases(PROJECT_QUOTA.releasesKept + 3, 100);
    expect(releasesToCollect(rows, { channels: ["r1"], jams: ["r3"] }, NOW)).toEqual(["r2"]);
  });

  it("counts pinned releases among the newest", () => {
    const rows = releases(PROJECT_QUOTA.releasesKept + 1, 100);
    expect(releasesToCollect(rows, { channels: ["r11"], jams: [] }, NOW)).toEqual(["r1"]);
  });

  it("counts only live releases toward the kept set", () => {
    const rows = releases(PROJECT_QUOTA.releasesKept + 2, 100);
    rows[0]!.collectedAt = daysAgo(50);
    expect(releasesToCollect(rows, NONE, NOW)).toEqual(["r2"]);
  });

  it("ranks by version, not by the order rows come in", () => {
    const rows = releases(PROJECT_QUOTA.releasesKept + 1, 100).reverse();
    expect(releasesToCollect(rows, NONE, NOW)).toEqual(["r1"]);
  });

  it("waits out the grace from creation", () => {
    const rows = releases(PROJECT_QUOTA.releasesKept + 1, 0);
    const oldest = rows[0]!;
    oldest.createdAt = new Date(NOW.getTime() - RELEASE_GRACE_DAYS * DAY + 1);
    expect(releasesToCollect(rows, NONE, NOW)).toEqual([]);
    oldest.createdAt = new Date(NOW.getTime() - RELEASE_GRACE_DAYS * DAY);
    expect(releasesToCollect(rows, NONE, NOW)).toEqual(["r1"]);
  });
});

describe("collectionForecast", () => {
  it("dates each unpinned release beyond the kept set at the first run after its grace", () => {
    const rows = releases(PROJECT_QUOTA.releasesKept + 2, 0);
    rows[0]!.createdAt = new Date("2026-11-01T10:00:00Z");
    rows[1]!.createdAt = new Date("2026-11-01T02:00:00Z");
    expect(collectionForecast(rows, NONE, NOW)).toEqual([
      { version: 1, at: new Date("2026-11-16T03:30:00Z") },
      { version: 2, at: new Date("2026-11-15T03:30:00Z") },
    ]);
  });

  it("dates a release already past its grace at the next run", () => {
    const rows = releases(PROJECT_QUOTA.releasesKept + 1, 100);
    expect(collectionForecast(rows, NONE, NOW)).toEqual([
      { version: 1, at: new Date("2026-11-13T03:30:00Z") },
    ]);
  });

  it("leaves out the kept set and pinned releases", () => {
    const rows = releases(PROJECT_QUOTA.releasesKept + 2, 0);
    expect(collectionForecast(releases(PROJECT_QUOTA.releasesKept), NONE, NOW)).toEqual([]);
    expect(
      collectionForecast(rows, { channels: [], jams: ["r1"] }, NOW).map((f) => f.version),
    ).toEqual([2]);
  });

  it("names exactly what releasesToCollect takes once its date comes", () => {
    const rows = releases(PROJECT_QUOTA.releasesKept + 4, 0);
    for (const { version, at } of collectionForecast(rows, NONE, NOW)) {
      expect(releasesToCollect(rows, NONE, at)).toContain(`r${version}`);
      expect(releasesToCollect(rows, NONE, new Date(at.getTime() - DAY))).not.toContain(
        `r${version}`,
      );
    }
  });
});

describe("nextCollectorRun", () => {
  it("is today's run until it has passed, then tomorrow's", () => {
    expect(nextCollectorRun(new Date("2026-11-12T03:00:00Z"))).toEqual(
      new Date("2026-11-12T03:30:00Z"),
    );
    expect(nextCollectorRun(new Date("2026-11-12T03:30:00Z"))).toEqual(
      new Date("2026-11-12T03:30:00Z"),
    );
    expect(nextCollectorRun(new Date("2026-12-31T03:31:00Z"))).toEqual(
      new Date("2027-01-01T03:30:00Z"),
    );
  });
});

describe("blobsDue", () => {
  const graceAgo = (ms = 0) => new Date(NOW.getTime() - BLOB_GRACE_DAYS * DAY + ms);

  it("takes an unreferenced blob only after the whole quiet period", () => {
    const row = (lastReferencedAt: Date | null, createdAt = daysAgo(400)) => [
      { sha256: "a", createdAt, lastReferencedAt },
    ];
    expect(blobsDue(["a"], row(graceAgo(1)), NOW)).toEqual([]);
    expect(blobsDue(["a"], row(graceAgo()), NOW)).toEqual(["a"]);
  });

  it("dates a blob never referenced from when it was stored", () => {
    expect(
      blobsDue(["a"], [{ sha256: "a", createdAt: graceAgo(1), lastReferencedAt: null }], NOW),
    ).toEqual([]);
    expect(
      blobsDue(["a"], [{ sha256: "a", createdAt: graceAgo(), lastReferencedAt: null }], NOW),
    ).toEqual(["a"]);
  });

  it("never takes a referenced blob, however old", () => {
    const rows = [
      { sha256: "a", createdAt: daysAgo(400), lastReferencedAt: daysAgo(300) },
      { sha256: "b", createdAt: daysAgo(400), lastReferencedAt: null },
    ];
    expect(blobsDue(["b"], rows, NOW)).toEqual(["b"]);
  });
});

describe("savesDue", () => {
  it("is the expiry before now", () => {
    expect(savesDue(NOW)).toEqual(daysAgo(SITE_SAVE_EXPIRY_DAYS));
  });
});

/** `count` versions of `scene`, number 1 oldest, one a day ending `ageOfNewest` days ago. */
function versions(scene: string, count: number, ageOfNewest = 0): SceneVersionRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${scene}-${i + 1}`,
    scene,
    number: i + 1,
    createdAt: daysAgo(ageOfNewest + count - 1 - i),
    collectedAt: null,
  }));
}

describe("sceneVersionsToCollect", () => {
  const KEPT = LIVE_LIMITS.keptPerScene;

  it("keeps the 5 newest of each scene, however old", () => {
    expect(KEPT).toBe(5);
    const rows = [...versions("yard", KEPT, 400), ...versions("hall", KEPT, 400)];
    expect(sceneVersionsToCollect(rows, [], NOW)).toEqual([]);
  });

  it("collects each scene's versions beyond its newest, oldest first, scenes apart", () => {
    const rows = [...versions("yard", KEPT + 2, 100), ...versions("hall", KEPT + 1, 100)];
    expect(sceneVersionsToCollect(rows, [], NOW)).toEqual(["hall-1", "yard-1", "yard-2"]);
  });

  it("keeps a version a channel points at, at any age", () => {
    const rows = versions("yard", KEPT + 3, 1000);
    expect(sceneVersionsToCollect(rows, ["yard-1", "yard-3"], NOW)).toEqual(["yard-2"]);
  });

  it("counts a pointed version among the newest", () => {
    const rows = versions("yard", KEPT + 1, 100);
    expect(sceneVersionsToCollect(rows, [`yard-${KEPT + 1}`], NOW)).toEqual(["yard-1"]);
  });

  it("counts only versions not yet collected toward the kept set", () => {
    const rows = versions("yard", KEPT + 2, 100);
    rows[0]!.collectedAt = daysAgo(50);
    expect(sceneVersionsToCollect(rows, [], NOW)).toEqual(["yard-2"]);
  });

  it("ranks by number, not by the order rows come in", () => {
    const rows = versions("yard", KEPT + 1, 100).reverse();
    expect(sceneVersionsToCollect(rows, [], NOW)).toEqual(["yard-1"]);
  });

  it("waits out the 14-day grace from creation", () => {
    expect(RELEASE_GRACE_DAYS).toBe(14);
    const rows = versions("yard", KEPT + 1, 0);
    const oldest = rows[0]!;
    oldest.createdAt = new Date(NOW.getTime() - RELEASE_GRACE_DAYS * DAY + 1);
    expect(sceneVersionsToCollect(rows, [], NOW)).toEqual([]);
    oldest.createdAt = new Date(NOW.getTime() - RELEASE_GRACE_DAYS * DAY);
    expect(sceneVersionsToCollect(rows, [], NOW)).toEqual(["yard-1"]);
  });
});

describe("sceneVersionForecast", () => {
  const KEPT = LIVE_LIMITS.keptPerScene;

  it("dates each unpointed version beyond its scene's kept set at the first run after its grace", () => {
    const rows = [...versions("yard", KEPT + 2, 0), ...versions("hall", KEPT + 1, 100)];
    rows[0]!.createdAt = new Date("2026-11-01T10:00:00Z");
    rows[1]!.createdAt = new Date("2026-11-01T02:00:00Z");
    expect(sceneVersionForecast(rows, [], NOW)).toEqual([
      { scene: "hall", number: 1, at: new Date("2026-11-13T03:30:00Z") },
      { scene: "yard", number: 1, at: new Date("2026-11-16T03:30:00Z") },
      { scene: "yard", number: 2, at: new Date("2026-11-15T03:30:00Z") },
    ]);
  });

  it("leaves out the kept set and pointed versions", () => {
    expect(sceneVersionForecast(versions("yard", KEPT), [], NOW)).toEqual([]);
    const rows = versions("yard", KEPT + 2, 0);
    expect(sceneVersionForecast(rows, ["yard-1"], NOW).map((f) => f.number)).toEqual([2]);
  });

  it("names exactly what sceneVersionsToCollect takes once its date comes", () => {
    const rows = [...versions("yard", KEPT + 3, 0), ...versions("hall", KEPT + 2, 5)];
    const forecast = sceneVersionForecast(rows, [], NOW);
    expect(forecast).toHaveLength(5);
    for (const { scene, number, at } of forecast) {
      expect(sceneVersionsToCollect(rows, [], at)).toContain(`${scene}-${number}`);
      expect(sceneVersionsToCollect(rows, [], new Date(at.getTime() - DAY))).not.toContain(
        `${scene}-${number}`,
      );
    }
  });
});

describe("reportsDue", () => {
  it("is the 30-day retention before now", () => {
    expect(LIVE_REPORT_RETENTION_DAYS).toBe(30);
    expect(reportsDue(NOW)).toEqual(daysAgo(LIVE_REPORT_RETENTION_DAYS));
  });
});

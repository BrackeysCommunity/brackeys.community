import { measureBudget } from "@jams/engine/export";
import {
  checkReleaseManifest,
  parseReleaseManifest,
  releaseSnapshot,
  sha256,
} from "@jams/engine/project";
import { describe, expect, it } from "vite-plus/test";

import { plannedRelease, type PlannedRelease } from "./release-fixture";

async function hashes(release: PlannedRelease): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [path, bytes] of release.files) out.set(path, await sha256(bytes));
  return out;
}

describe("plannedRelease", () => {
  it("passes checkReleaseManifest with its files", async () => {
    const release = await plannedRelease();
    expect(
      await checkReleaseManifest(release.manifest, await hashes(release), { measureBudget }),
    ).toEqual([]);
    expect([...release.files.keys()].sort()).toEqual(
      release.manifest.build.files.map((f) => f.path).sort(),
    );
    for (const f of release.manifest.build.files)
      expect(release.files.get(f.path)!.length).toBe(f.bytes);
  });

  it("holds a scene, a data doc, a PNG and a code chunk, physics-free", async () => {
    const { manifest, files } = await plannedRelease();
    const kinds = Object.values(manifest.assets).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["scene", "data-table", "texture"]));
    expect(manifest.build.rapier).toBeNull();
    expect(manifest.flow.scenes.every((s) => s.physics === "none")).toBe(true);
    const png = files.get(manifest.assets["tiles"]!.file)!;
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(manifest.build.files.filter((f) => f.role === "code").map((f) => f.path)).toEqual([
      manifest.build.entry,
    ]);
  });

  it("is canonical and reproducible: the same text and id every time", async () => {
    const a = await plannedRelease();
    const b = await plannedRelease();
    expect(b.text).toBe(a.text);
    expect(b.releaseId).toBe(a.releaseId);
    expect(a.releaseId).toBe(await sha256(a.text));
    const parsed = parseReleaseManifest(a.text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(releaseSnapshot(parsed.manifest).hash).toBe(a.manifest.project.snapshot);
  });

  it("changes one scene's data file for another hall variant", async () => {
    const a = await plannedRelease();
    const b = await plannedRelease({ hallVariant: 1 });
    expect(b.releaseId).not.toBe(a.releaseId);
    const data = (r: PlannedRelease) =>
      new Set(
        r.manifest.build.files.filter((f) => f.path.startsWith("data/")).map((f) => f.sha256),
      );
    const added = [...data(b)].filter((h) => !data(a).has(h));
    expect(added).toHaveLength(1);
    expect(b.manifest.assets["hall"]!.sha256).toBe(added[0]);
  });

  it("takes the project id, game id and engine version it is given", async () => {
    const r = await plannedRelease({ projectId: "p-1", gameId: "other", engineVersion: "0.13.0" });
    expect(r.manifest.project.id).toBe("p-1");
    expect(r.manifest.game.id).toBe("other");
    expect(r.manifest.engine.version).toBe("0.13.0");
    expect(r.text).toContain('"version": "0.13.0"');
    expect(await checkReleaseManifest(r.manifest, await hashes(r))).toEqual([]);
  });

  it("adds distinct extra files of the size asked, still a valid release", async () => {
    const r = await plannedRelease({ extraFiles: { count: 3, bytes: 4096 } });
    const extra = r.manifest.build.files.filter((f) => f.path.startsWith("code/chunk-"));
    expect(extra.map((f) => f.bytes)).toEqual([4096, 4096, 4096]);
    expect(new Set(extra.map((f) => f.sha256)).size).toBe(3);
    expect(await checkReleaseManifest(r.manifest, await hashes(r), { measureBudget })).toEqual([]);
  });
});

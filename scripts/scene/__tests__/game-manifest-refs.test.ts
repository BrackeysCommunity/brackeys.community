import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { RELEASE_FILE } from "@jams/engine/project";
import { afterAll, describe, expect, it } from "vite-plus/test";

import {
  plannedRelease,
  type PlannedReleaseOptions,
} from "../../../src/lib/engine/__tests__/release-fixture";
import { checkManifestAt } from "../tools/game-manifest";

const dirs: string[] = [];

/** A planned release written out as a build directory. */
async function buildDir(opts: PlannedReleaseOptions = {}): Promise<string> {
  const r = await plannedRelease(opts);
  const dir = await mkdtemp(join(tmpdir(), "game-manifest-refs-"));
  dirs.push(dir);
  await writeFile(join(dir, RELEASE_FILE), r.text);
  for (const [path, bytes] of r.files) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), bytes);
  }
  return dir;
}

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("checkManifestAt", () => {
  it("checks a build directory clean, its shipped docs' references included", async () => {
    const checked = await checkManifestAt(await buildDir());
    if (!checked.ok) throw new Error(checked.result.text);
    expect(checked.issues).toEqual([]);
  });

  it("reads each shipped doc from the directory and refuses a reference outside assets", async () => {
    const dir = await buildDir({ danglingAnimation: true });
    const checked = await checkManifestAt(dir);
    if (!checked.ok) throw new Error(checked.result.text);
    expect(checked.issues).toEqual([
      expect.objectContaining({
        code: "asset-missing",
        path: "/assets/spare-animation",
        entityIds: ["spare-animation", "band"],
      }),
    ]);
    const alone = await checkManifestAt(join(dir, RELEASE_FILE));
    if (!alone.ok) throw new Error(alone.result.text);
    expect(alone.issues).toEqual([]);
  });
});

import { measureBudget } from "@jams/engine/export";
import {
  checkReleaseManifest,
  findRelease,
  formatReleaseManifest,
  parseReleaseManifest,
  releaseId,
} from "@jams/engine/project";

import { planLane } from "./export-plan";

/** Reads a `release.json` the way `game manifest` and the standalone host do: parse, then check. */
export async function readRelease(text: string) {
  const parsed = parseReleaseManifest(text);
  if (!parsed.ok) return { ok: false, codes: parsed.issues.map((i) => i.code) };
  const issues = await checkReleaseManifest(parsed.manifest, undefined, { measureBudget });
  return {
    ok: issues.length === 0,
    id: await releaseId(parsed.manifest),
    manifest: parsed.manifest,
    codes: issues.map((i) => i.code),
  };
}

export async function laneRelease() {
  const { plan } = await planLane();
  const text = formatReleaseManifest(plan.manifest);
  const read = await readRelease(text);
  const m = plan.manifest;
  // The code's listed hash changed after the build: `build.hash` no longer reproduces.
  const edited = structuredClone(m);
  edited.build.files = edited.build.files.map((f) =>
    f.role === "code" ? { ...f, sha256: "c".repeat(64) } : f,
  );
  const tampered = await readRelease(formatReleaseManifest(edited));
  // A recording made on this release names it; one made before releases matches by snapshot.
  const id = await releaseId(m);
  const releases = [{ id, manifest: m }];
  const engine = { version: m.engine.version, physics: null };
  const project = { id: m.project.id, snapshot: m.project.snapshot };
  return {
    sameId: read.id === id,
    read: read.codes,
    tampered: tampered.codes,
    byId: findRelease({ engine, project, release: id }, releases)?.id === id,
    bySnapshot: findRelease({ engine, project }, releases)?.id === id,
    elsewhere: findRelease({ engine, project: { ...project, snapshot: "0".repeat(64) } }, releases),
  };
}

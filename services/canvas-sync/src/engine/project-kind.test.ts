import { describe, expect, it } from "bun:test";

import {
  UNLIMITED_QUOTA,
  type AssetEntry,
  type ProjectState,
} from "../../../../src/engine/project/index.ts";
import { createRegistry } from "../../../../src/engine/scene/index.ts";
import {
  applyProjectDuties,
  emptyProjectState,
  ENGINE_KINDS,
  readProjectState,
  seedProjectState,
} from "../../../../src/lib/scene/project-bytes.ts";
import { planProjectDuties } from "./project-kind.ts";

const MISSING = "f".repeat(64);
const STORED = "a".repeat(64);
const EARLIER = "b".repeat(64);

const crate: AssetEntry = {
  key: "crate",
  id: "crate",
  kind: "texture",
  path: "art/crate.png",
  created: { at: 1, by: "alice" },
  sha256: MISSING,
  bytes: 99,
  meta: { format: "png", width: 64, height: 64 },
};

const plan = (state: ProjectState, stored: ProjectState | null, known: string[]) =>
  planProjectDuties({
    state,
    stored: () => stored,
    now: 5,
    kinds: ENGINE_KINDS,
    registry: createRegistry(null),
    quota: UNLIMITED_QUOTA,
    values: () => new Map(),
    knownBlobs: async () => new Set(known),
    hasRow: () => true,
    rows: async () => [],
  });

describe("planProjectDuties", () => {
  const base = emptyProjectState("demo", "Demo");

  it("reverts a missing hash to the stored one with the stored meta", async () => {
    const meta = { format: "png", width: 8, height: 8 };
    const stored = { ...base, assets: { crate: { ...crate, sha256: STORED, bytes: 4, meta } } };
    const { duties } = await plan({ ...base, assets: { crate } }, stored, [STORED]);
    expect(duties.hashes).toEqual([{ key: "crate", to: { sha256: STORED, bytes: 4, meta } }]);
    const after = readProjectState(applyProjectDuties(seedProjectState(stored), duties).state);
    expect(after.assets.crate).toMatchObject({ sha256: STORED, bytes: 4, meta });
  });

  it("reverts a missing hash to one from history without meta, so nothing describes the missing bytes", async () => {
    const state: ProjectState = {
      ...base,
      assets: { crate },
      history: { crate: [{ sha256: EARLIER, bytes: 3, at: 1, by: "alice" }] },
    };
    const { duties } = await plan(state, null, [EARLIER]);
    expect(duties.hashes).toEqual([{ key: "crate", to: { sha256: EARLIER, bytes: 3 } }]);
    const after = readProjectState(applyProjectDuties(seedProjectState(state), duties).state);
    expect(after.assets.crate).toMatchObject({ sha256: EARLIER, bytes: 3 });
    expect(after.assets.crate!.meta).toBeUndefined();
  });
});

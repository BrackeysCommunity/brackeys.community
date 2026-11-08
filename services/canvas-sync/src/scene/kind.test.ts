import { describe, expect, it } from "bun:test";

import { SCENE_FORMAT_VERSION } from "../../../../src/engine/scene/types.ts";
import { signCanvasToken, verifyCanvasToken } from "../../../../src/lib/canvas/token.ts";
import { COLLAB_LAYOUT_VERSION } from "../../../../src/lib/scene/project-bytes.ts";
import { SyncMetrics } from "../telemetry.ts";
import { createSceneKind } from "./kind.ts";
import { MemorySceneStore } from "./store.ts";

const SECRET = "scene-kind-test-secret-1234";

async function claims(l?: number) {
  const token = await signCanvasToken(
    { c: "scene:jam.level-1", u: "alice", a: "write", k: "scene", f: SCENE_FORMAT_VERSION, l },
    SECRET,
  );
  const verified = await verifyCanvasToken(token, SECRET);
  if (!verified) throw new Error("the token didn't verify");
  return verified;
}

describe("the scene kind's layout check", () => {
  const store = new MemorySceneStore();
  store.create("jam.level-1");
  const scene = createSceneKind({
    store,
    documents: () => new Map(),
    now: Date.now,
    metrics: new SyncMetrics(),
  });

  it("admits a client on this layout for writing", async () => {
    expect(await scene.admit("jam.level-1", await claims(COLLAB_LAYOUT_VERSION))).toEqual({});
  });

  it("connects a client on the layout before this one read-only, told to reload", async () => {
    expect(COLLAB_LAYOUT_VERSION).toBe(3);
    const grant = await scene.admit("jam.level-1", await claims(COLLAB_LAYOUT_VERSION - 1));
    expect(grant.readOnly).toBe(true);
    expect(JSON.parse(grant.notice ?? "null")).toEqual({
      type: "scene-read-only",
      reason: "engine-outdated",
      schemaVersion: SCENE_FORMAT_VERSION,
      layout: COLLAB_LAYOUT_VERSION,
    });
  });

  it("connects a client on a newer layout read-only until this instance can migrate", async () => {
    const grant = await scene.admit("jam.level-1", await claims(COLLAB_LAYOUT_VERSION + 1));
    expect(grant.readOnly).toBe(true);
    expect(JSON.parse(grant.notice ?? "null")).toMatchObject({
      reason: "server-outdated",
      layout: COLLAB_LAYOUT_VERSION,
    });
  });

  it("reads a scene token without `l` as layout 1, so it connects read-only instead of being refused", async () => {
    const grant = await scene.admit("jam.level-1", await claims());
    expect(grant.readOnly).toBe(true);
    expect(JSON.parse(grant.notice ?? "null")).toEqual({
      type: "scene-read-only",
      reason: "engine-outdated",
      schemaVersion: SCENE_FORMAT_VERSION,
      layout: COLLAB_LAYOUT_VERSION,
    });
  });
});

// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectSession,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
} from "../../collab/index";
import { createRegistry } from "../../game/index";
import { createKindRegistry, prefabKind, sceneKind, type AssetEntry } from "../../project/index";
import { SCENE_FORMAT_VERSION } from "../../scene/index";
import { useSceneDoc, type SceneDocSource } from "../connect/scene-doc";
import type { ProjectConnectionState } from "../host";

const kinds = createKindRegistry(null, [sceneKind, prefabKind]);

const scene = (id: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind: "scene",
  path,
  created: { at: 0, by: "seed" },
});

/** A live source over a project with the scenes `a-yard` and `b-yard`. */
async function liveSource(): Promise<SceneDocSource & { destroy(): void }> {
  const host = memoryDocHost();
  const all = [scene("a-yard", "scenes/a.json"), scene("b-yard", "scenes/b.json")];
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: Object.fromEntries(all.map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  for (const e of all)
    sceneToDoc(
      { v: SCENE_FORMAT_VERSION, name: e.id, bounds: [0, 0, 100, 100] },
      { doc: host.doc(`scene:p.${e.key}`), key: sequentialKeys(e.key) },
    );
  const session = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: { kind: "user", userId: "u", name: "U" },
    registry: createRegistry(),
    kinds,
  });
  const state: ProjectConnectionState = {
    status: "live",
    session,
    access: "write",
    stopped: {},
    error: null,
    unsynced: 0,
  };
  return { getState: () => state, subscribe: () => () => {}, destroy: () => session.destroy() };
}

afterEach(cleanup);

describe("useSceneDoc", () => {
  it("keeps the open doc and its fallback when asked for the scene it fell back to", async () => {
    const source = await liveSource();
    const release = vi.spyOn(source.getState().session!, "release");
    const hook = renderHook(({ id }) => useSceneDoc(source, id), {
      initialProps: { id: "gone" as string | null },
    });
    await waitFor(() => expect(hook.result.current.ready?.id).toBe("a-yard"));
    const ready = hook.result.current.ready;

    hook.rerender({ id: "a-yard" });
    await act(async () => {});
    expect(hook.result.current.ready).toBe(ready);
    expect(hook.result.current.fellBack).toEqual({ wanted: "gone", opened: "a-yard" });
    expect(release).not.toHaveBeenCalled();
    hook.unmount();
    source.destroy();
  });

  it("opens another scene when asked for one that isn't open", async () => {
    const source = await liveSource();
    const hook = renderHook(({ id }) => useSceneDoc(source, id), {
      initialProps: { id: "a-yard" as string | null },
    });
    await waitFor(() => expect(hook.result.current.ready?.id).toBe("a-yard"));
    hook.rerender({ id: "b-yard" });
    await waitFor(() => expect(hook.result.current.ready?.id).toBe("b-yard"));
    expect(hook.result.current.fellBack).toBeNull();
    hook.unmount();
    source.destroy();
  });
});

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  ASSET_CHANGED,
  createProjectSession,
  memoryDocHost,
  seedProjectDoc,
  writeEntry,
  type AssetChangedMessage,
} from "../../collab/index";
import { defineGame } from "../../game/index";
import type { GameInstance } from "../../index";
import { createKindRegistry, type AssetEntry } from "../../project/index";
import { createRegistry } from "../../scene/index";
import { editorIdentity, projectRegistry } from "../session/live-scene-editor";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);

const game = defineGame({
  id: "follow-assets",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const kinds = createKindRegistry(game);

const crate: AssetEntry = {
  key: "crate",
  id: "crate",
  kind: "texture",
  path: "art/crate.png",
  created: { at: 0, by: "seed" },
  sha256: OLD,
  bytes: 10,
  meta: { format: "png", width: 40, height: 20 },
};

const message: AssetChangedMessage = {
  type: ASSET_CHANGED,
  project: "p",
  key: "crate",
  id: "crate",
  kind: "texture",
  path: "art/crate.png",
  sha256: NEW,
  bytes: 12,
  previous: OLD,
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
  vi.restoreAllMocks();
});

/** Follows a re-import of `crate` into a game whose `reloadAssets` is `reload`. */
async function reimportInto(reload: GameInstance["reloadAssets"]) {
  const host = memoryDocHost();
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: { crate },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  const session = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: editorIdentity("Ada").origin,
    registry: createRegistry(game),
    kinds,
  });
  cleanups.push(() => session.destroy());
  const watch = projectRegistry(session);
  cleanups.push(() => watch.destroy());
  await watch.ready();
  let send: ((m: AssetChangedMessage) => void) | undefined;
  const reloadAssets = vi.fn(reload);
  cleanups.push(
    watch.followAssets(
      {
        onAssetChanged(listener) {
          send = listener;
          return () => (send = undefined);
        },
      },
      { reloadAssets },
    ),
  );
  writeEntry(host.doc("project:p"), { ...crate, sha256: NEW, bytes: 12 });
  send?.(message);
  await new Promise((r) => setTimeout(r, 0));
  expect(reloadAssets).toHaveBeenCalledTimes(1);
}

const resolved = (errors: Awaited<ReturnType<GameInstance["reloadAssets"]>>["errors"]) =>
  Promise.resolve({ failed: [], errors });

describe("followAssets", () => {
  it("warns about each entity whose redraw threw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await reimportInto(() =>
      resolved([{ entityId: "pic", error: "update broke", reattached: false }]),
    );
    expect(warn).toHaveBeenCalledWith("[assets] hot reload: pic: update broke");
  });

  it("warns instead of leaving a rejected reload unhandled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await reimportInto(() => Promise.reject(new Error("loader gone")));
    expect(warn).toHaveBeenCalledWith("[assets] hot reload: loader gone");
  });

  it("stays quiet when the reload went through", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await reimportInto(() => resolved([]));
    expect(warn).not.toHaveBeenCalled();
  });
});

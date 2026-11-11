import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  ASSET_CHANGED,
  createProjectSession,
  layoutPatch,
  layoutToDoc,
  memoryDocHost,
  seedProjectDoc,
  writeEntry,
  type AssetChangedMessage,
} from "../../collab/index";
import { defineGame } from "../../game/index";
import type { GameInstance, GameMode } from "../../index";
import {
  createKindRegistry,
  gameSettingsKind,
  type AssetEntry,
  type DocLayout,
} from "../../project/index";
import { createRegistry } from "../../scene/index";
import { editorIdentity, projectRegistry } from "../session/live-scene-editor";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);

const game = defineGame({
  id: "follow-assets",
  types: [],
  actions: [],
  projectSettings: {
    speed: z.number().positive().default(1).describe("How fast, m/s."),
  },
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

const settingsLayout = gameSettingsKind.layout as DocLayout;
const settingsEntry: AssetEntry = {
  key: "settings",
  id: "settings",
  kind: "game-settings",
  path: "game-settings.json",
  created: { at: 0, by: "seed" },
};
const settingsAt = (speed: number) => ({
  kind: "game-settings",
  v: 1,
  engine: {},
  game: { speed },
});

/** A project with game settings, followed by a game in `mode`; `edit` changes the speed. */
async function followedIn(mode: GameMode) {
  const host = memoryDocHost();
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: { settings: settingsEntry },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  layoutToDoc(host.doc("asset:p.settings"), settingsLayout, settingsAt(2));
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
  const reloadAssets = vi.fn(() => resolved([]));
  cleanups.push(
    watch.followAssets({ onAssetChanged: () => () => {} }, { reloadAssets, getMode: () => mode }),
  );
  const edit = (speed: number) =>
    layoutPatch(host.doc("asset:p.settings"), settingsLayout, settingsAt(speed));
  return { watch, reloadAssets, edit };
}

describe("followAssets on a project change", () => {
  it("hands a playing game the new data with nothing changed", async () => {
    const { watch, reloadAssets, edit } = await followedIn("play");
    edit(3);
    expect(reloadAssets).toHaveBeenCalledTimes(1);
    const [update] = reloadAssets.mock.calls[0] as unknown as Parameters<
      GameInstance["reloadAssets"]
    >;
    expect(update.project).toBe(watch.project());
    expect(update.project?.settings).toEqual({ speed: 3 });
    expect(update.view.byId.has("settings")).toBe(true);
    expect(update.changed).toEqual([]);
  });

  it("stays quiet for an edit that leaves the data as it was", async () => {
    const { reloadAssets, edit } = await followedIn("play");
    edit(2);
    expect(reloadAssets).not.toHaveBeenCalled();
  });

  it("leaves a game outside Play to the host's rebuild", async () => {
    const { reloadAssets, edit } = await followedIn("edit");
    edit(3);
    expect(reloadAssets).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { loadCompatRapier } from "../../__tests__/fixtures/compat-rapier";
import { testGame } from "../../__tests__/fixtures/test-game";
import {
  createProjectSession,
  layoutPatch,
  layoutToDoc,
  memoryDocHost,
  seedProjectDoc,
} from "../../collab/index";
import type { GameDefinition } from "../../game/index";
import { createGame, type GameInstance, type RapierModule } from "../../index";
import {
  createKindRegistry,
  INPUT_MAP_KIND,
  INPUT_MAP_VERSION,
  inputMapKind,
  type AssetEntry,
  type DocLayout,
} from "../../project/index";
import { createRegistry, type SceneDefinition } from "../../scene/index";
import { editorIdentity, projectRegistry } from "../session/live-scene-editor";

vi.mock("../../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const scene: SceneDefinition = {
  v: 1,
  name: "floor-only",
  bounds: [0, 0, 5, 5],
  solid: [["box", 2.5, 4.9, 2.5, 0.1]],
};

/** The test game plus a `jump` button, recording each step's actions. */
function jumpGame() {
  const steps: string[][] = [];
  const game: GameDefinition = {
    ...testGame,
    actions: [
      ...testGame.actions!,
      { action: "jump", description: "Jump.", bindings: [{ device: "key", code: "KeyJ" }] },
    ],
    createRuntime(ctx) {
      const base = testGame.createRuntime(ctx);
      return {
        ...base,
        beforeStep(dtMs, actions, commands) {
          steps.push(actions.map((a) => `${a.action}:${a.pressed ? 1 : 0}`));
          base.beforeStep?.(dtMs, actions, commands);
        },
      };
    },
  };
  return { game, steps };
}

const mapLayout = inputMapKind.layout as DocLayout;
const mapOn = (code: string) => ({
  kind: INPUT_MAP_KIND,
  v: INPUT_MAP_VERSION,
  actions: [{ action: "jump", bindings: [{ device: "key", code }] }],
});

const controls: AssetEntry = {
  key: "controls",
  id: "controls",
  kind: INPUT_MAP_KIND,
  path: "input-map.json",
  created: { at: 0, by: "seed" },
};

let rapier: RapierModule;
const cleanups: (() => void)[] = [];

beforeAll(async () => {
  rapier = await loadCompatRapier();
});

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** A project whose input map binds `jump` to F, followed by a game the editor plays. */
async function playing() {
  const { game: def, steps } = jumpGame();
  const host = memoryDocHost();
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: { controls },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  layoutToDoc(host.doc("asset:p.controls"), mapLayout, mapOn("KeyF"));
  const session = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: editorIdentity("Ada").origin,
    registry: createRegistry(def),
    kinds: createKindRegistry(def),
  });
  cleanups.push(() => session.destroy());
  const watch = projectRegistry(session);
  cleanups.push(() => watch.destroy());
  await watch.ready();
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const game: GameInstance = await createGame(canvas, {
    rapier: async () => rapier,
    game: def,
    registry: watch.current(),
    project: watch.project(),
  });
  cleanups.push(() => game.destroy());
  cleanups.push(watch.followAssets({ onAssetChanged: () => () => {} }, game));
  expect(game.play(scene).ok).toBe(true);
  const edit = async (code: string) => {
    layoutPatch(host.doc("asset:p.controls"), mapLayout, mapOn(code));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { game, steps, edit };
}

const key = (game: GameInstance, code: string, type: "down" | "up" = "down") =>
  game.router.dispatch({
    kind: "key",
    type,
    key: code,
    code,
    native: new KeyboardEvent(`key${type}`, { code }),
  });

describe("editor Play with a co-edited input map", () => {
  it("drives the action from the binding the edit made, mid-run", async () => {
    const { game, steps, edit } = await playing();
    key(game, "KeyF");
    game.step();
    expect(steps.at(-1)).toEqual(["jump:1"]);
    key(game, "KeyF", "up");
    game.step();

    await edit("KeyG");
    expect(game.getMode()).toBe("play");
    expect(game.input.bindings().jump).toEqual([{ device: "key", code: "KeyG" }]);

    key(game, "KeyF");
    game.step();
    expect(steps.at(-1)).toEqual([]);
    key(game, "KeyF", "up");

    key(game, "KeyG");
    game.step();
    expect(steps.at(-1)).toEqual(["jump:1"]);
  });
});

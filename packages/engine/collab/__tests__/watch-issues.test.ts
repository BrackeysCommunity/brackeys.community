import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { gridField, pointField } from "../../game/fields";
import type { DocLayout } from "../../project/kinds";
import { animationKind, type AnimationFile } from "../../project/kinds/animation";
import type { AssetEntry, ProjectState } from "../../project/types";
import { projectView } from "../../project/view";
import { engine } from "../../scene/__tests__/fixtures/fake-game";
import type { Prefab } from "../../scene/types";
import { sceneToDoc } from "../convert";
import { layoutPatch, layoutToDoc } from "../layout";
import { docToPrefab, prefabPatch, prefabToDoc } from "../prefab-doc";
import { localPrefabSource, staticPrefabSource } from "../prefab-source";
import type { ProjectSessionEvent } from "../project-session";
import { issueRuntime, validateDoc, watchIssues, type IssueProject } from "../watch-issues";
import { ada } from "./helpers";

const lamp = { id: "lamp", type: "marker", at: [0, 0] as [number, number] };
const prefab = (id: string, over: Partial<Prefab> = {}): Prefab => ({
  kind: "prefab",
  v: 4,
  id,
  entities: [lamp],
  ...over,
});

describe("validateDoc on a prefab doc", () => {
  it("reports a nested instance that reaches the open prefab as prefab-cycle", () => {
    // The library's copy of `loop` is stale: it doesn't hold `outer` yet.
    const library = new Map<string, Prefab>([
      ["loop", prefab("loop")],
      ["outer", prefab("outer", { instances: [{ id: "in", prefab: "loop", at: [0, 0] }] })],
    ]);
    const doc = prefabToDoc(
      prefab("loop", { instances: [{ id: "o1", prefab: "outer", at: [0, 0] }] }),
    );
    const issues = validateDoc(doc, engine, { prefabs: staticPrefabSource(library) });
    expect(issues.map((i) => i.code)).toContain("prefab-cycle");
  });

  it("doesn't ask a prefab with a grid child for settings.grid", () => {
    const PAINT = defineEntityType({
      type: "paint",
      description: "Painted cells.",
      base: "marker",
      fields: { at: pointField("The grid's corner."), cells: gridField("The cells.") },
    });
    const painter = createRegistry(
      defineGame({
        id: "painter",
        types: [PAINT],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const tiles = prefab("tiles", {
      game: "painter",
      entities: [{ id: "floor", type: "paint", at: [0, 0], cells: { "0,0": ["1*4"] } }],
    });
    const library = new Map([["tiles", tiles]]);
    const issues = validateDoc(prefabToDoc(tiles), painter, {
      prefabs: staticPrefabSource(library),
    });
    expect(issues).toEqual([]);
  });
});

describe("watchIssues", () => {
  const library = () =>
    new Map<string, Prefab>([
      [
        "outer",
        prefab("outer", { entities: [], instances: [{ id: "m", prefab: "mid", at: [0, 0] }] }),
      ],
      [
        "mid",
        prefab("mid", { entities: [], instances: [{ id: "i", prefab: "inner", at: [0, 0] }] }),
      ],
      ["inner", prefab("inner")],
      ["room", prefab("room")],
      ["red", prefab("red", { entities: [], base: "room" })],
    ]);
  const edit = (prefabs: ReturnType<typeof localPrefabSource>, id: string) => {
    const doc = prefabs.docs().get(id)!;
    const cur = docToPrefab(doc);
    prefabPatch(doc, { ...cur, id, entities: [{ ...lamp, at: [40, 0] }] }, ada);
  };
  /** Watches `doc` on a manual timer: `runs` counts validations, `pending` whether one is scheduled. */
  function watched(
    doc: Parameters<typeof watchIssues>[0],
    prefabs: ReturnType<typeof localPrefabSource>,
  ) {
    let pending: (() => void) | null = null;
    let runs = 0;
    const watch = watchIssues(doc, engine, () => runs++, {
      prefabs,
      setTimer: (fn) => (pending = fn),
      clearTimer: () => (pending = null),
    });
    return {
      watch,
      pending: () => pending !== null,
      fire() {
        const fn = pending;
        pending = null;
        fn?.();
        return runs;
      },
    };
  }
  const scene = (prefabId: string) =>
    sceneToDoc({
      v: 4,
      name: "reach",
      bounds: [0, 0, 1000, 1000],
      instances: [{ id: "o", prefab: prefabId, at: [100, 100] }],
      entities: [],
    });

  it("revalidates after an edit to a prefab nested two levels down", () => {
    const prefabs = localPrefabSource(library());
    const w = watched(scene("outer"), prefabs);
    edit(prefabs, "inner");
    expect(w.pending()).toBe(true);
    expect(w.fire()).toBe(1);
    w.watch.stop();
  });

  it("revalidates after an edit to a variant's base, from a scene and from the variant's own doc", () => {
    const prefabs = localPrefabSource(library());
    const fromScene = watched(scene("red"), prefabs);
    const fromVariant = watched(prefabToDoc(library().get("red")!), prefabs);
    edit(prefabs, "room");
    expect(fromScene.fire()).toBe(1);
    expect(fromVariant.fire()).toBe(1);
    fromScene.watch.stop();
    fromVariant.watch.stop();
  });

  it("leaves a scene alone when a prefab it doesn't reach changes", () => {
    const prefabs = localPrefabSource(library());
    const w = watched(scene("outer"), prefabs);
    edit(prefabs, "room");
    expect(w.pending()).toBe(false);
    w.watch.stop();
  });
});

describe("anim blocks in a doc's issues", () => {
  const LAYOUT = animationKind.layout as DocLayout;
  const frame = (x: number) => ({ x, y: 0, w: 16, h: 16 });
  const atlas = (key: string, frames: string[]): AssetEntry => ({
    key,
    id: key,
    kind: "atlas",
    path: `${key}.json`,
    created: { at: 0, by: "t" },
    sha256: key[0]!.repeat(64),
    meta: {
      tool: "aseprite",
      frames: Object.fromEntries(frames.map((f, i) => [f, frame(16 * i)])),
      tags: [],
      slices: [],
      order: frames,
    },
  });
  const MOVES: AssetEntry = {
    key: "mv",
    id: "moves",
    kind: "animation",
    path: "moves.animation.json",
    created: { at: 0, by: "t" },
  };
  const state: ProjectState = {
    meta: { projectId: "p", layout: 2, name: "P" },
    assets: {
      hero: atlas("hero", ["idle-0", "run-0"]),
      knight: atlas("knight", ["idle-0"]),
      mv: MOVES,
    },
    history: {},
    code: {},
    build: {},
  };
  const moves = (clips: AnimationFile["clips"]): AnimationFile => ({
    kind: "animation",
    v: 1,
    atlas: "hero",
    clips,
  });
  const JAB = { name: "jab", frames: [{ frame: "idle-0" }] };
  const KICK = { name: "kick", frames: [{ frame: "run-0" }] };

  /** A project as a `ProjectSession` holds it: the animation doc opens when `open()` is called. */
  function sessionLike() {
    const doc = layoutToDoc(new Y.Doc(), LAYOUT, moves([JAB, KICK]));
    let isOpen = false;
    const listeners = new Set<(e: ProjectSessionEvent) => void>();
    const project: IssueProject = {
      view: () => projectView(state),
      docNameFor: (entry) => (entry.key === "mv" ? "doc:mv" : null),
      get: (name) => (isOpen && name === "doc:mv" ? { doc, layout: LAYOUT } : undefined),
      subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    };
    const open = () => {
      isOpen = true;
      for (const l of listeners) l({ type: "open", doc: "doc:mv" });
    };
    return { doc, project, open };
  }
  const pic = (asset: string, clip: string) =>
    sceneToDoc({
      v: 1,
      name: "t",
      bounds: [0, 0, 1000, 1000],
      entities: [
        {
          id: "pic",
          type: "marker",
          at: [10, 10],
          behaviors: { sprite: { asset, frame: "idle-0" }, anim: { source: "moves", clip } },
        },
      ],
    });
  const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

  it("reads an animation source from its open doc: a clip it lacks, a sprite missing its frames", () => {
    const { project, open } = sessionLike();
    expect(issueRuntime(project, engine)).toBeUndefined();
    expect(codes(validateDoc(pic("hero", "jabb"), engine, { project }))).toEqual([]);
    open();
    const unknown = validateDoc(pic("hero", "jabb"), engine, { project });
    expect(unknown).toEqual([
      expect.objectContaining({ code: "anim-clip-unknown", got: "jabb", expected: "jab | kick" }),
    ]);
    expect(validateDoc(pic("knight", "jab"), engine, { project })).toEqual([
      expect.objectContaining({ code: "anim-atlas-mismatch", got: "knight", expected: "hero" }),
    ]);
    expect(validateDoc(pic("hero", "kick"), engine, { project })).toEqual([]);
  });

  it("revalidates when the animation doc opens and when it changes", () => {
    const { doc: animation, project, open } = sessionLike();
    const seen: string[][] = [];
    let pending: (() => void) | null = null;
    const watch = watchIssues(pic("hero", "kick"), engine, (i) => seen.push(codes(i)), {
      project,
      setTimer: (fn) => (pending = fn),
      clearTimer: () => (pending = null),
    });
    expect(watch.flush()).toEqual([]);

    open();
    expect(pending).not.toBeNull();
    pending!();
    expect(seen.at(-1)).toEqual([]);

    layoutPatch(animation, LAYOUT, moves([JAB]));
    expect(pending).not.toBeNull();
    pending!();
    expect(seen.at(-1)).toEqual(["anim-clip-unknown"]);

    watch.stop();
    layoutPatch(animation, LAYOUT, moves([JAB, KICK]));
    pending = null;
    open();
    expect(pending).toBeNull();
  });
});

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { createEditorSession } from "../../editor/session";
import { createRegistry } from "../../game/define";
import type { DocLayout } from "../../project/kinds";
import { GAME_SETTINGS_KIND, gameSettingsKind } from "../../project/kinds/game-settings";
import type { AssetEntry, ProjectState } from "../../project/types";
import { projectView } from "../../project/view";
import type { SceneDefinition } from "../../scene/types";
import { sceneToDoc } from "../convert";
import { layoutPatch, layoutToDoc } from "../layout";
import { issueEngine, validateDoc, watchIssues, type IssueProject } from "../watch-issues";
import { ada } from "./helpers";

const registry = createRegistry();
const LAYOUT = gameSettingsKind.layout as DocLayout;

/** A prop, which needs physics, in a scene that leaves physics to the project. */
const yard = (): SceneDefinition => ({
  v: 1,
  name: "yard",
  bounds: [0, 0, 640, 480],
  entities: [
    { id: "crate", type: "prop", shape: ["box", 200, 200, 20, 20], density: 1, restitution: 0 },
  ],
});

const SETTINGS: AssetEntry = {
  key: "gs",
  id: "game-settings",
  kind: GAME_SETTINGS_KIND,
  path: "game-settings.json",
  created: { at: 1, by: "t" },
};
const state: ProjectState = {
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: { gs: SETTINGS },
  history: {},
  code: {},
  build: {},
};

/** A project whose game-settings doc is open, as a `ProjectSession` holds it. */
function sessionLike(engine: Record<string, unknown>) {
  const doc = layoutToDoc(new Y.Doc(), LAYOUT, {
    kind: GAME_SETTINGS_KIND,
    v: 1,
    engine,
    game: {},
  });
  const project: IssueProject = {
    view: () => projectView(state),
    docNameFor: (entry) => (entry.key === "gs" ? "doc:gs" : null),
    get: (name) => (name === "doc:gs" ? { doc, layout: LAYOUT } : undefined),
  };
  return { doc, project };
}

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

describe("the project's engine block in a doc's issues", () => {
  it("validateDoc resolves physics through a view's engine block", () => {
    const doc = sceneToDoc(yard());
    expect(codes(validateDoc(doc, registry))).not.toContain("physics-required");
    const project: IssueProject = {
      view: () => ({ ...projectView(state), engine: { physics: "none" } }),
    };
    expect(codes(validateDoc(doc, registry, { project }))).toContain("physics-required");
  });

  it("reads the open game-settings doc, and revalidates when it changes", () => {
    const { doc: settings, project } = sessionLike({ physics: "none" });
    expect(issueEngine(project)).toEqual({ physics: "none" });
    const doc = sceneToDoc(yard());
    const seen: string[][] = [];
    let pending: (() => void) | null = null;
    const watch = watchIssues(doc, registry, (issues) => seen.push(codes(issues)), {
      project,
      setTimer: (fn) => (pending = fn),
      clearTimer: () => (pending = null),
    });
    expect(watch.flush()).toEqual([expect.objectContaining({ code: "physics-required" })]);

    layoutPatch(settings, LAYOUT, { kind: GAME_SETTINGS_KIND, v: 1, engine: {}, game: {} });
    expect(pending).not.toBeNull();
    pending!();
    expect(seen.at(-1)).not.toContain("physics-required");
    watch.stop();
  });

  it("an editor session lists physics-required and hands the block to its physical checks", () => {
    const { project } = sessionLike({ physics: "none" });
    const session = createEditorSession({
      doc: sceneToDoc(yard()),
      origin: ada,
      name: "yard",
      registry,
      issuesDebounceMs: 0,
      project,
    });
    expect(codes(session.store.state.issues)).toContain("physics-required");
    expect(session.engine()).toEqual({ physics: "none" });
    session.destroy();

    const bare = createEditorSession({ doc: sceneToDoc(yard()), origin: ada, name: "y", registry });
    expect(bare.engine()).toBeUndefined();
    expect(codes(bare.store.state.issues)).not.toContain("physics-required");
    bare.destroy();
  });
});

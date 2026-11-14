import { createRegistry } from "../../../game/define";
import { applyOps, toSourceBatch } from "../../../scene/ops";
import { prefabLibrary } from "../../../scene/prefab";
import { resolveScene } from "../../../scene/resolve";
import {
  SCENE_FORMAT_VERSION,
  type OpBatch,
  type Prefab,
  type SceneDefinition,
} from "../../../scene/types";
import type { EditSource } from "../tree";

export const registry = createRegistry();

const turret: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "turret",
  entities: [
    { id: "base", type: "solid", shape: ["box", 0, -0.2, 0.4, 0.2] },
    { id: "barrel", type: "solid", shape: ["box", 0.5, -0.5, 0.5, 0.1] },
  ],
} as Prefab;

export const prefabs = prefabLibrary([turret]);

/**
 * A node with a child and a grandchild, an instance at the root with a
 * document entity under one of its children, an instance under the node,
 * and a lone solid.
 */
export const doc: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "tree",
  bounds: [0, 0, 20, 10],
  instances: [
    { id: "turret-a", prefab: "turret", at: [2, 6] },
    { id: "tilt-turret", prefab: "turret", parent: "tilt", at: [1, 0] },
  ],
  entities: [
    { id: "tilt", type: "node", at: [10, 5] },
    { id: "tilt-board", type: "solid", parent: "tilt", shape: ["box", 0, 1, 0.5, 0.1] },
    { id: "tilt-mark", type: "marker", parent: "tilt-board", at: [0.5, 0] },
    { id: "flag", type: "marker", parent: "turret-a/barrel", at: [0, -0.3] },
    { id: "lone", type: "solid", shape: ["box", 15, 5, 0.5, 0.5] },
  ],
};

export const source: EditSource = { doc, prefabs };

export const viewOf = (d: SceneDefinition): SceneDefinition => resolveScene(d, registry, prefabs);

export const view = viewOf(doc);

/** `batch`, written for the view, committed to the document as the editor does, and resolved again. */
export function commit(batch: OpBatch, d: SceneDefinition = doc): SceneDefinition {
  const mapped = toSourceBatch(d, batch, registry, prefabs);
  if (!mapped.ok) throw new Error(mapped.issue.message);
  const result = applyOps(d, mapped.batch, registry, { prefabs });
  if (!result.ok) throw new Error(result.issue.message);
  return result.def;
}

/** `batch` applied to the view, as the editor's preview shows it. */
export function previewed(batch: OpBatch, v: SceneDefinition = view): SceneDefinition {
  const result = applyOps(v, batch, registry, { validate: "none" });
  if (!result.ok) throw new Error(result.issue.message);
  return result.def;
}

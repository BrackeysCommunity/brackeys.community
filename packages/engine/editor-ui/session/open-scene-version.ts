import type * as Y from "yjs";

import type { ProjectSession } from "../../collab/index";
import { docValue } from "../../collab/project-apply";
import type { GameDefinition, Registry } from "../../game/types";
import {
  buildSceneVersion,
  formatAssetDoc,
  type AssetEntry,
  type AssetId,
  type BuildSceneVersionResult,
} from "../../project/index";

/** How many times a build reopens the docs it found missing before giving up. */
const REOPEN_ROUNDS = 4;

/** The canonical text of a project doc as its file would hold it; null for a kind with no text. */
function docText(project: ProjectSession, entry: AssetEntry, doc: Y.Doc): string | null {
  const def = project.kinds.get(entry.kind);
  if (def?.storage !== "doc") return null;
  const name = project.docNameFor(entry);
  const layout = name ? project.get(name)?.layout : undefined;
  try {
    const value = docValue({ doc, kind: entry.kind, ...(layout ? { layout } : {}) });
    return value === undefined ? null : formatAssetDoc(def, value);
  } catch {
    return null;
  }
}

/** Every open project doc's text by asset id, `scene`'s from `doc`. */
export function openDocTexts(
  project: ProjectSession,
  scene: AssetId,
  doc: Y.Doc,
): Map<AssetId, string> {
  const out = new Map<AssetId, string>();
  for (const entry of project.view().byId.values()) {
    const name = project.docNameFor(entry);
    const from = entry.id === scene ? doc : name ? project.get(name)?.doc : undefined;
    if (!from) continue;
    const text = docText(project, entry, from);
    if (text !== null) out.set(entry.id, text);
  }
  return out;
}

export type BuildOpenSceneVersionOptions = {
  /**
   * Called after the build for each doc it opened; true keeps the doc open
   * (the caller then releases it), false or omitted lets it go.
   */
  keep?: (name: string) => boolean;
};

/**
 * `buildSceneVersion` over `doc` as it is now and the project's open docs,
 * opening the docs it reaches that nobody has open (a few rounds deep) and
 * letting them go again after, unless `opts.keep` holds on to them.
 */
export async function buildOpenSceneVersion(
  project: ProjectSession,
  scene: AssetId,
  doc: Y.Doc,
  registry: Registry,
  game: GameDefinition,
  opts: BuildOpenSceneVersionOptions = {},
): Promise<BuildSceneVersionResult> {
  const opened: string[] = [];
  try {
    for (let round = 0; ; round++) {
      const result = await buildSceneVersion({
        view: project.view(),
        texts: openDocTexts(project, scene, doc),
        build: project.hashes,
        game,
        registry,
        scene,
      });
      if (result.ok || round >= REOPEN_ROUNDS) return result;
      const closed = result.issues
        .filter((i) => i.code === "asset-missing")
        .flatMap((i) => i.entityIds)
        .map((id) => project.view().byId.get(id))
        .map((entry) => (entry ? project.docNameFor(entry) : null))
        .filter((name): name is string => !!name && !project.get(name) && !opened.includes(name));
      if (closed.length === 0) return result;
      await Promise.all(
        closed.map((name) => {
          opened.push(name);
          return project.open(name).catch(() => {});
        }),
      );
    }
  } finally {
    for (const name of opened) if (project.get(name) && !opts.keep?.(name)) project.release(name);
  }
}

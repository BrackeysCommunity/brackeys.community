import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { GameInstance } from "@jams/engine";
import { bindSceneDoc, type OpenDoc, type ProjectSession } from "@jams/engine/collab";
import { createEditorSession } from "@jams/engine/editor";
import { sceneKind } from "@jams/engine/project";
import * as Y from "yjs";

/** The project session's `openDoc` over one websocket: a provider per doc, resolved once it has synced. */
export function hocuspocusDocs(url = "ws://localhost:3000/__scene-collab"): OpenDoc {
  const socket = new HocuspocusProviderWebsocket({ url });
  return (name) =>
    new Promise((resolve, reject) => {
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc });
      const awareness = provider.awareness;
      if (!awareness) return reject(new Error(`"${name}": the provider has no awareness`));
      provider.on("synced", () => resolve({ doc, awareness, close: () => provider.destroy() }));
      provider.attach();
    });
}

/** The scene `wanted` names by id or display name, and its doc, which the session names by registry key. */
export function sceneDocOf(session: ProjectSession, wanted: string) {
  const scenes = [...session.view().byId.values()].filter((e) => e.kind === sceneKind.kind);
  const entry =
    scenes.find((e) => e.id === wanted) ??
    scenes.find((e) => (e.name ?? e.path.replace(/^.*\/|\.json$/g, "")) === wanted);
  const docName = entry && session.docNameFor(entry);
  return entry && docName ? { entry, docName } : null;
}

/** Opens scene `wanted` of the session's project, edits it as `userId`, and keeps the running game in step. */
export async function coEdit(
  game: Pick<GameInstance, "registry" | "runtime">,
  session: ProjectSession,
  wanted: string,
  userId: string,
) {
  const found = sceneDocOf(session, wanted);
  if (!found) throw new Error(`no scene "${wanted}" in ${session.project}`);
  const { doc, awareness } = await session.open(found.docName);
  const editor = createEditorSession({
    doc,
    origin: session.origin,
    registry: game.registry,
    name: found.entry.name ?? wanted,
    awareness,
    user: { id: userId, name: userId, color: "#6cf" },
    project: session,
  });
  const runtime = game.runtime();
  // Each transaction becomes entity-level adds, updates and removes, not a reload.
  const binding = runtime ? bindSceneDoc(doc, runtime, game.registry) : null;

  return {
    docName: found.docName,
    editor,
    move: (id: string) => editor.dispatch({ ops: [{ op: "move", refs: [id], by: [0.16, 0] }] }),
    undo: () => editor.undo(),
    close() {
      binding?.destroy();
      editor.destroy();
      session.release(found.docName);
    },
  };
}

import { HocuspocusProvider } from "@hocuspocus/provider";
import type { GameInstance } from "@jams/engine";
import { bindSceneDoc } from "@jams/engine/collab";
import { createEditorSession } from "@jams/engine/editor";
import * as Y from "yjs";

/** Opens `scene:<name>` from the dev server, edits it as `userId`, and keeps the running game in step. */
export function coEdit(game: GameInstance, name: string, userId: string) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: "ws://localhost:3000/__scene-collab",
    name: `scene:${name}`,
    document: doc,
  });
  const runtime = game.runtime();
  let binding: ReturnType<typeof bindSceneDoc> | null = null;
  let session: ReturnType<typeof createEditorSession> | null = null;

  provider.on("synced", () => {
    if (session) return;
    session = createEditorSession({
      doc,
      origin: { kind: "user", userId },
      registry: game.registry,
      name,
      awareness: provider.awareness ?? undefined,
      user: { id: userId, name: userId, color: "#6cf" },
    });
    // Each transaction becomes entity-level adds, updates and removes, not a reload.
    if (runtime) binding = bindSceneDoc(doc, runtime, game.registry);
  });

  return {
    move: (id: string) => session?.dispatch({ ops: [{ op: "move", refs: [id], by: [16, 0] }] }),
    undo: () => session?.undo(),
    close() {
      binding?.destroy();
      session?.destroy();
      provider.destroy();
    },
  };
}

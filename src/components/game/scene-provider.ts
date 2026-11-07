import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import * as Y from "yjs";

import { sceneDocName } from "./scene-collab";
import type { ConnectSceneDoc } from "./use-scene-doc";

/**
 * A Hocuspocus provider on a fresh doc. Loaded with the editor, so neither
 * the provider nor `yjs` reaches a production bundle. The dev server has no
 * auth, so there are no tokens or close codes to handle here.
 */
export const connectSceneDoc: ConnectSceneDoc = ({ url, name, events }) => {
  const doc = new Y.Doc();
  const provider: HocuspocusProvider = new HocuspocusProvider({
    url,
    name: sceneDocName(name),
    document: doc,
    onSynced: ({ state }) => {
      if (state) events.synced();
    },
    onClose: () => events.closed(),
    onStatus: ({ status }) => {
      if (status === WebSocketStatus.Disconnected) events.closed();
    },
  });
  return {
    doc,
    awareness: provider.awareness,
    provider,
    // The doc outlives its provider: the editor keeps it until a fresh connection syncs.
    destroy: () => provider.destroy(),
  };
};

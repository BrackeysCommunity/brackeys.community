import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import type { JsonCanvas } from "@/lib/canvas/json-canvas";

import { canvasQueryOptions } from "./canvas-queries";
import type { PresenceStore } from "./editor/presence-store";

export interface ReaderLive {
  presence: PresenceStore | null;
  /** The doc as it is now, once synced; null until then. */
  snapshot: JsonCanvas | null;
}

const OFF: ReaderLive = { presence: null, snapshot: null };

/**
 * A signed-in reader's live seat on the canvas, so they see the others'
 * cursors, chat and edits as they happen. Signed-out visitors, and anyone
 * the live service isn't on for, stay on the stored snapshot.
 */
export function useReaderLive(canvasId: string, enabled: boolean): ReaderLive {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const signedIn = session?.user != null;
  const [live, setLive] = useState<ReaderLive>(OFF);

  useEffect(() => {
    if (!enabled || !signedIn) return;
    let cancelled = false;
    let destroy: (() => void) | null = null;
    void (async () => {
      const [{ firstSyncSession }, { connectReader }] = await Promise.all([
        import("./editor/use-canvas-sync"),
        import("./editor/reader-sync"),
      ]);
      const first = await firstSyncSession(canvasId);
      if (cancelled || !first) return;
      const connection = connectReader(
        canvasId,
        first,
        (snapshot) => setLive((prev) => ({ ...prev, snapshot })),
        () => {
          connection.destroy();
          setLive(OFF);
          void queryClient.invalidateQueries({ queryKey: canvasQueryOptions(canvasId).queryKey });
        },
      );
      destroy = () => connection.destroy();
      setLive({ presence: connection.presence, snapshot: null });
    })();
    return () => {
      cancelled = true;
      destroy?.();
      setLive(OFF);
    };
  }, [canvasId, enabled, signedIn, queryClient]);

  return live;
}

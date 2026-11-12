import { Store } from "@tanstack/store";
import { useEffect, useRef, useState } from "react";

import type { AssetChangedMessage, ProjectSession, SessionDoc } from "../../collab/index";
import type { ProjectId } from "../../project/index";
import {
  CONNECTION_OFF,
  connectProjectSession,
  type ConnectProjectSessionOptions,
} from "../connect/project-session";
import type { ProjectConnectionState } from "../host";
import { useStoreValue } from "./use-store-value";

export type UseProjectSessionOptions = Omit<ConnectProjectSessionOptions, "project"> & {
  /** Null keeps the session closed. */
  project: ProjectId | null;
  /** Called with each `asset:changed` message on the project; the latest callback is used. */
  onAssetChanged?: (message: AssetChangedMessage) => void;
};

/**
 * The live project `project` as a `ProjectSession`, open while the
 * component is mounted. The session is rebuilt when the project, the URL,
 * whether it takes tokens, or the access asked for changes; the rest of the
 * options are read when it opens.
 */
export function useProjectSession(options: UseProjectSessionOptions): ProjectConnectionState {
  const [store] = useState(() => new Store<ProjectConnectionState>(CONNECTION_OFF));
  const latest = useRef(options);
  // Declared before the connecting effect, so it sees this render's options.
  useEffect(() => {
    latest.current = options;
  });
  const { project, url, access = "write" } = options;
  const hosted = Boolean(options.tokens);

  useEffect(() => {
    if (project === null) return;
    const link = connectProjectSession({ ...latest.current, project });
    const copy = () => store.setState(() => link.getState());
    const unsubscribe = link.subscribe(copy);
    const unwatch = link.onAssetChanged((message) => latest.current.onAssetChanged?.(message));
    copy();
    return () => {
      unsubscribe();
      unwatch();
      link.destroy();
      store.setState(() => CONNECTION_OFF);
    };
  }, [store, project, url, hosted, access]);

  return useStoreValue(store);
}

/** How long a doc the editor switched away from stays connected. */
export const WARM_DOC_MS = 60_000;

/**
 * Keeps docs a little longer: `keep(session, name)` holds `name` once more
 * from now, while the editor still holds it, and lets go `keepMs` later, so
 * a doc the editor switches away from stays connected that long. Unmounting
 * lets go of every doc it still keeps at once.
 */
export function useWarmDocs(
  keepMs: number = WARM_DOC_MS,
): (session: ProjectSession, name: string) => void {
  const [cooling] = useState(() => new Set<() => void>());
  useEffect(
    () => () => {
      for (const release of [...cooling]) release();
    },
    [cooling],
  );
  const after = useRef(keepMs);
  useEffect(() => {
    after.current = keepMs;
  });
  const [keep] = useState(() => (session: ProjectSession, name: string) => {
    // A doc held already is held once more before `open` returns, so nothing can close it in between.
    session.open(name).then(
      () => {
        const release = () => {
          clearTimeout(timer);
          cooling.delete(release);
          session.release(name);
        };
        const timer = setTimeout(release, after.current);
        cooling.add(release);
      },
      () => {},
    );
  });
  return keep;
}

/**
 * Holds one doc of the session open while the component is mounted. When
 * it unmounts the session lets the doc go, and closes it unless an undo
 * step still names it.
 */
export function useSessionDoc(
  session: ProjectSession | null,
  name: string | null,
): { doc: SessionDoc | null; error: Error | null } {
  const [held, setHeld] = useState<{
    key: string;
    doc: SessionDoc | null;
    error: Error | null;
  } | null>(null);
  const key = session && name ? `${session.name}\n${name}` : null;

  useEffect(() => {
    if (!session || !name || key === null) return;
    let gone = false;
    let holds = false;
    session.open(name).then(
      (doc) => {
        if (gone) return session.release(name);
        holds = true;
        setHeld({ key, doc, error: null });
      },
      (error: unknown) => {
        if (!gone) {
          setHeld({
            key,
            doc: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => {
      gone = true;
      if (holds) session.release(name);
    };
  }, [session, name, key]);

  return held && held.key === key ? held : { doc: null, error: null };
}

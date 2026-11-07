import { HocuspocusProvider } from "@hocuspocus/provider";
import { docMeta, type SceneDocMeta } from "@jams/engine/collab";
import { SCENE_COLLAB_PATH, SCENE_ROUTE, sceneDocName } from "@jams/engine/vite";
import * as Y from "yjs";

/** The collab server `vp dev` runs (`package.json`'s `dev` script serves port 3000). */
export const DEFAULT_LIVE_URL = `ws://localhost:3000${SCENE_COLLAB_PATH}`;
export const LIVE_TIMEOUT_MS = 10_000;

export class LiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveError";
  }
}

export type LiveScene = {
  doc: Y.Doc;
  meta: SceneDocMeta;
  provider: HocuspocusProvider;
  /** Resolves once the server has acknowledged every local change. */
  pushed(): Promise<void>;
  close(): void;
};

async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new LiveError(`Timed out after ${ms}ms waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** `ws://host/__scene-collab` → `http://host/__scene`. */
function listUrl(url: string): string {
  const u = new URL(url);
  u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  u.pathname = SCENE_ROUTE;
  u.search = "";
  return u.toString();
}

/**
 * Opens scene `name` on a collab server as a Yjs client and waits for the
 * first sync. Checks the server's scene list first, so a missing scene or a
 * server that isn't running fails fast instead of retrying.
 */
export async function openLiveScene(opts: {
  url: string;
  scene: string;
  timeoutMs?: number;
}): Promise<LiveScene> {
  const timeoutMs = opts.timeoutMs ?? LIVE_TIMEOUT_MS;
  if (typeof globalThis.WebSocket !== "function")
    throw new LiveError("This runtime has no global WebSocket; run the CLI under Bun or Node 22+.");
  let scenes: unknown;
  try {
    const res = await fetch(listUrl(opts.url), { signal: AbortSignal.timeout(timeoutMs) });
    scenes = ((await res.json()) as { scenes?: unknown }).scenes;
  } catch (e) {
    throw new LiveError(
      `Can't reach the scene collab server at ${opts.url} (${(e as Error).message}); is \`vp dev\` running?`,
    );
  }
  if (Array.isArray(scenes) && !scenes.includes(opts.scene))
    throw new LiveError(
      `The collab server at ${opts.url} has no scene named ${JSON.stringify(opts.scene)}.`,
    );

  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: opts.url,
    name: sceneDocName(opts.scene),
    document: doc,
  });
  const close = () => {
    provider.destroy();
    doc.destroy();
  };
  try {
    await until(() => provider.synced, timeoutMs, `${sceneDocName(opts.scene)} to sync`);
  } catch (e) {
    close();
    throw e;
  }
  const meta = docMeta(doc);
  if (!meta) {
    close();
    throw new LiveError(`${sceneDocName(opts.scene)} synced empty: the server didn't seed it.`);
  }
  return {
    doc,
    meta,
    provider,
    pushed: () =>
      until(() => !provider.hasUnsyncedChanges, timeoutMs, "the server to acknowledge the batch"),
    close,
  };
}

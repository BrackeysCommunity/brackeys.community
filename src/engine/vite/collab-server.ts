import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import type { Server as HocuspocusServer } from "@hocuspocus/server";
import type * as Y from "yjs";

import {
  createSceneFileAdapter,
  sceneDocName,
  sceneOfDocName,
  type DiskSync,
  type SceneFileAdapter,
  type SceneHome,
} from "./file-adapter";
import { createFileSceneStore, handleSceneRequest, type SceneStore } from "./handler";
import { prefabsDirOf } from "./prefab-files";
import { sceneNameOf } from "./scene-paths";

/** Where the dev server accepts collab websockets. */
export const SCENE_COLLAB_PATH = "/__scene-collab";

export type SceneCollabOptions = {
  /** Scenes directories and their registries; a scene name resolves across all of them. */
  homes: readonly SceneHome[];
  /** The websocket path; defaults to `SCENE_COLLAB_PATH`. */
  path?: string;
  /** How long after the last edit a doc is written back, in ms. */
  debounceMs?: number;
  /** How long a file must be quiet before its change is read, in ms. */
  watchDelayMs?: number;
  /** Where refused disk changes and failed loads are reported; defaults to `console.warn`. */
  warn?: (message: string) => void;
  /**
   * The `@hocuspocus/server` module, for a host whose module loader is gone
   * by the time the first client connects (a config loaded through Vite's
   * `runnerImport`). Imported on first use when left out.
   */
  hocuspocus?: Pick<typeof import("@hocuspocus/server"), "Server">;
};

export type SceneCollab = {
  /** The in-process Hocuspocus server; it never listens on its own. */
  server: HocuspocusServer;
  adapter: SceneFileAdapter;
  /** Takes an HTTP upgrade for the collab path; returns false for any other URL. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  /** Resolves once every queued file read and write has finished. */
  idle(): Promise<void>;
  destroy(): Promise<void>;
};

const pathOf = (req: IncomingMessage) => new URL(req.url ?? "/", "http://localhost").pathname;

/**
 * A browser sends `Origin` with every websocket; a page on another site
 * must not reach the dev server's scenes. Node and Bun clients send none.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** A client that already hung up resets the socket; without a listener that error would crash the host. */
const ignoreErrors = (socket: Duplex) => {
  if (socket.listenerCount("error") === 0) socket.on("error", () => undefined);
};

function refuse(socket: Duplex, status: string): void {
  ignoreErrors(socket);
  if (socket.writable) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  else socket.destroy();
}

/**
 * Hocuspocus for the scene files in `homes`, in this process. A doc named
 * `scene:<name>` is seeded from `<dir>/<name>.json` when the first client
 * opens it (the server is the only seeder), written back as canonical JSON
 * when its text changes, and a change to the file from outside becomes one
 * `disk` transaction. Needs `@hocuspocus/server`, which is imported here
 * and only here, and Node: its websocket adapter refuses to run under Bun.
 */
export async function createSceneCollab(options: SceneCollabOptions): Promise<SceneCollab> {
  const { Server } = options.hocuspocus ?? (await import("@hocuspocus/server"));
  const path = options.path ?? SCENE_COLLAB_PATH;
  const warn = options.warn ?? ((m: string) => console.warn(`[scene-collab] ${m}`));
  const adapter = createSceneFileAdapter(options.homes);

  const queues = new Map<string, Promise<unknown>>();
  function enqueue<T>(name: string, task: () => Promise<T>): Promise<T> {
    const run = (queues.get(name) ?? Promise.resolve()).then(task, task);
    const settled = run.catch(() => undefined);
    queues.set(name, settled);
    settled.then(() => {
      if (queues.get(name) === settled) queues.delete(name);
    });
    return run;
  }

  const report = (name: string, result: DiskSync) => {
    if (result.kind !== "refused") return;
    const first = result.issues?.[0];
    warn(`${name}: ${result.reason}${first ? ` (${first.code}: ${first.message})` : ""}`);
  };

  const server: HocuspocusServer = new Server({
    name: "jams-engine scenes",
    quiet: true,
    stopOnSignals: false,
    debounce: options.debounceMs ?? 500,
    maxDebounce: Math.max(options.debounceMs ?? 500, 2_000),
    unloadImmediately: true,
    async onLoadDocument({ documentName, document }) {
      const name = sceneOfDocName(documentName);
      if (!name) throw new Error(`${documentName} isn't a scene document; use scene:<name>.`);
      await enqueue(name, () => adapter.load(name, document)).catch((e: unknown) => {
        warn(`${documentName}: ${(e as Error).message}`);
        throw e;
      });
    },
    async onStoreDocument({ documentName, document }) {
      const name = sceneOfDocName(documentName);
      if (!name) return;
      await enqueue(name, async () => {
        // An outside change the watcher hasn't read yet goes in first, so the write can't clobber it.
        report(name, await adapter.sync(name, document));
        await adapter.store(name, document);
      });
    },
    async afterUnloadDocument({ documentName }) {
      const name = sceneOfDocName(documentName);
      if (name) await enqueue(name, async () => adapter.forget(name));
    },
  });

  const loadedDoc = (name: string): Y.Doc | undefined =>
    server.hocuspocus.documents.get(sceneDocName(name));

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const watchers: FSWatcher[] = [];
  for (const home of options.homes) {
    try {
      const settle = options.watchDelayMs ?? 30;
      // An editor or a script may still be mid-write when the first event
      // arrives; a file that doesn't parse is read once more before it's reported.
      const schedule = (name: string, delay: number, retried: boolean) => {
        clearTimeout(timers.get(name));
        timers.set(
          name,
          setTimeout(() => {
            timers.delete(name);
            enqueue(name, async () => {
              const doc = loadedDoc(name);
              if (!doc || !adapter.homeOf(name)) return;
              const result = await adapter.sync(name, doc);
              if (result.kind === "refused" && result.issues && !retried && !timers.has(name))
                schedule(name, settle * 5, true);
              else report(name, result);
            }).catch((e: unknown) => warn(`${name}: ${(e as Error).message}`));
          }, delay),
        );
      };
      const watcher = watch(home.dir, (_event, file) => {
        const name = file ? sceneNameOf(String(file)) : null;
        if (name && loadedDoc(name)) schedule(name, settle, false);
      });
      watcher.on("error", (e) => warn(`watching ${home.dir}: ${e.message}`));
      watchers.push(watcher);
      // A prefab belongs to every scene in its home, so a change syncs each loaded one.
      mkdirSync(prefabsDirOf(home.dir), { recursive: true });
      const prefabWatcher = watch(prefabsDirOf(home.dir), () => {
        for (const doc of server.hocuspocus.documents.keys()) {
          const name = sceneOfDocName(doc);
          if (name && adapter.homeOf(name)?.dir === home.dir) schedule(name, settle, false);
        }
      });
      prefabWatcher.on("error", (e) => warn(`watching ${prefabsDirOf(home.dir)}: ${e.message}`));
      watchers.push(prefabWatcher);
    } catch (e) {
      warn(`can't watch ${home.dir}: ${(e as Error).message}`);
    }
  }

  return {
    server,
    adapter,
    handleUpgrade(req, socket, head) {
      if (pathOf(req) !== path) return false;
      if (!sameOrigin(req)) {
        refuse(socket, "403 Forbidden");
        return true;
      }
      // `Server` owns the websocket adapter and runs it from its own http server's upgrade event.
      server.httpServer.emit("upgrade", req, socket, head);
      return true;
    },
    async idle() {
      while (timers.size > 0 || queues.size > 0) {
        await Promise.all([...queues.values()]);
        if (timers.size > 0) await new Promise((r) => setTimeout(r, 10));
      }
    },
    async destroy() {
      for (const w of watchers) w.close();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      await server.destroy();
      await Promise.all([...queues.values()]);
    },
  };
}

/** Answers `GET /__scene` (the scene names) and `GET /__scene/:name`; false for other URLs. */
async function serveSceneRequest(
  store: SceneStore,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const result = await handleSceneRequest(
    { method: req.method ?? "GET", url: req.url ?? "" },
    store,
  );
  if (!result) return false;
  res.statusCode = result.status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(result.body));
  return true;
}

type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** The subset of a Vite plugin this entry uses, typed here so the package needs no `vite` peer. */
export type SceneCollabPlugin = {
  name: string;
  apply: "serve";
  configureServer(server: {
    middlewares: { use(fn: Middleware): unknown };
    httpServer?: {
      on(event: "upgrade", listener: UpgradeListener): unknown;
      on(event: "close", listener: () => void): unknown;
    } | null;
  }): void;
};

/**
 * The dev server's scenes: `GET /__scene` lists them, `GET /__scene/:name`
 * reads one, and websockets on `/__scene-collab` co-edit them as
 * `scene:<name>` documents. Never part of a build.
 */
export function sceneCollabServer(options: SceneCollabOptions): SceneCollabPlugin {
  const path = options.path ?? SCENE_COLLAB_PATH;
  return {
    name: "jams-engine:scene-collab",
    apply: "serve",
    configureServer(vite) {
      const store = createFileSceneStore(options.homes.map((h) => h.dir));
      vite.middlewares.use((req, res, next) => {
        serveSceneRequest(store, req, res)
          .then((handled) => {
            if (!handled) next();
          })
          .catch(next);
      });
      const http = vite.httpServer;
      if (!http) {
        (options.warn ?? console.warn)(
          "[scene-collab] the dev server has no http server (middleware mode); collab is off.",
        );
        return;
      }
      let collab: Promise<SceneCollab> | undefined;
      http.on("upgrade", (req, socket, head) => {
        if (pathOf(req) !== path) return;
        ignoreErrors(socket);
        collab ??= createSceneCollab(options);
        collab
          .then((c) => c.handleUpgrade(req, socket, head))
          .catch((e: unknown) => {
            (options.warn ?? console.warn)(`[scene-collab] ${(e as Error).message}`);
            refuse(socket, "503 Service Unavailable");
          });
      });
      http.on("close", () => {
        collab?.then((c) => c.destroy()).catch(() => undefined);
      });
    },
  };
}

export type ListeningSceneCollab = SceneCollab & {
  /** `ws://host:port/__scene-collab`. */
  url: string;
  /** `http://host:port`, which answers `GET /__scene`. */
  httpUrl: string;
  close(): Promise<void>;
};

/** The collab server on a port of its own, for tests and for running it outside Vite. */
export async function listenSceneCollab(
  options: SceneCollabOptions & { port?: number; host?: string },
): Promise<ListeningSceneCollab> {
  const collab = await createSceneCollab(options);
  const store = createFileSceneStore(options.homes.map((h) => h.dir));
  const http = createServer((req, res) => {
    serveSceneRequest(store, req, res)
      .then((handled) => {
        if (handled) return;
        res.statusCode = 404;
        res.end();
      })
      .catch(() => {
        res.statusCode = 500;
        res.end();
      });
  });
  http.on("upgrade", (req, socket, head) => {
    if (!collab.handleUpgrade(req, socket, head)) refuse(socket, "404 Not Found");
  });
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? 0, host, () => resolve());
  });
  const { port } = http.address() as AddressInfo;
  return {
    ...collab,
    url: `ws://${host}:${port}${options.path ?? SCENE_COLLAB_PATH}`,
    httpUrl: `http://${host}:${port}`,
    async close() {
      await collab.destroy();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

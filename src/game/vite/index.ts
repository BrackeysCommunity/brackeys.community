import type { IncomingMessage, ServerResponse } from "node:http";

import { createFileSceneStore, handleSceneRequest, MAX_SCENE_BYTES } from "./handler";

export { resolveScenePath, sceneNameOf, SCENE_NAME_PATTERN, ScenePathError } from "./scene-paths";

type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/** The subset of a Vite plugin this entry uses, typed here so the package needs no `vite` peer. */
export type SceneDevSinkPlugin = {
  name: string;
  apply: "serve";
  configureServer(server: { middlewares: { use(fn: Middleware): unknown } }): void;
};

export type SceneDevSinkOptions = { dir: string };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_SCENE_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Dev-server endpoints that list, read and write scenes in `dir`. Never part of a build. */
export function sceneDevSink({ dir }: SceneDevSinkOptions): SceneDevSinkPlugin {
  const store = createFileSceneStore(dir);
  return {
    name: "jams-engine:scene-dev-sink",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/__scene")) return next();
        const method = req.method ?? "GET";
        const body = method === "POST" ? readBody(req) : Promise.resolve(undefined);
        body
          .then((text) => {
            const headers: Record<string, string | undefined> = {};
            for (const name of ["content-type", "origin", "host", "sec-fetch-site"]) {
              const v = req.headers[name];
              headers[name] = Array.isArray(v) ? v[0] : v;
            }
            return handleSceneRequest({ method, url, body: text, headers }, store);
          })
          .then((result) => {
            if (!result) return next();
            res.statusCode = result.status;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(result.body));
          })
          .catch((e: unknown) => {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
            );
          });
      });
    },
  };
}

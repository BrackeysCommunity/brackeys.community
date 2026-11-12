import { mkdtemp, readFile, rm } from "node:fs/promises";
/**
 * The runner's side of the render run, under Bun: the engine project read
 * from `packages/engine/scenes` through the dev server's own file scan, and the
 * preview middleware that serves its blobs by hash on the dev route
 * (`/__project/<id>/blob/<sha256>`) with the dev server's handler, plus the
 * registry and doc values the page builds its project view from.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssetId, ProjectState } from "@jams/engine/project";
import { projectView } from "@jams/engine/project";
import { createProjectFileAdapter, fileContentStore, readFileProject } from "@jams/engine/vite";
import type { Plugin } from "vite-plus";

import {
  handleProjectRequest,
  type ProjectResponse,
  type ProjectSource,
} from "../../../packages/engine/vite/handler";
import { SINK_DATA_ROUTE } from "./sink";

/** What the page needs to build the project view, runtime view and registry: the scan's registry and every doc asset's JSON. */
export type SinkProjectData = { state: ProjectState; values: Record<AssetId, unknown> };

export type SinkProject = {
  source: ProjectSource;
  data: SinkProjectData;
  close(): Promise<void>;
};

/** The engine project as the dev server scans it, its blobs copied into a scratch content store. */
export async function loadSinkProject(scenesDir: string): Promise<SinkProject> {
  const cacheDir = await mkdtemp(join(tmpdir(), "jams-engine-smoke-project-"));
  try {
    const project = await readFileProject(scenesDir, { cacheDir });
    const scan = await createProjectFileAdapter(project).scan();
    if (scan.problems.length > 0)
      throw new Error(`the engine project scans with problems: ${JSON.stringify(scan.problems)}`);
    const view = projectView(scan.state, project.kinds);
    const values: Record<AssetId, unknown> = {};
    for (const entry of view.byId.values())
      if (entry.sha256 === undefined)
        values[entry.id] = JSON.parse(await readFile(join(project.dir, entry.path), "utf8"));
    return {
      source: { project, state: async () => scan.state, store: fileContentStore(cacheDir) },
      data: { state: scan.state, values },
      close: () => rm(cacheDir, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(cacheDir, { recursive: true, force: true });
    throw err;
  }
}

/** The answer to a GET of the data route or the dev blob route; null for any other URL. */
export async function answerSinkRequest(
  sink: Pick<SinkProject, "source" | "data">,
  req: { method: string; url: string; headers: IncomingMessage["headers"] },
): Promise<ProjectResponse | null> {
  const [path = ""] = req.url.split("?");
  if (path === SINK_DATA_ROUTE) {
    if (req.method !== "GET") return { status: 405, body: { ok: false, error: "Use GET." } };
    return { status: 200, body: sink.data };
  }
  // The smoke uploads nothing, so a POST finds no body to store.
  return handleProjectRequest({ ...req, body: async () => null }, [sink.source]);
}

/** `vite preview` serves only the build; this adds the routes the page loads the sink from. */
export function sinkPreviewPlugin(sink: SinkProject): Plugin {
  return {
    name: "jams-engine-smoke:sink-project",
    configurePreviewServer(server) {
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
          answerSinkRequest(sink, {
            method: req.method ?? "GET",
            url: req.url ?? "",
            headers: req.headers,
          }).then((result) => {
            if (!result) return next();
            res.statusCode = result.status;
            if (result.body instanceof Uint8Array) {
              for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, v);
              res.end(result.body);
            } else {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(result.body));
            }
          }, next);
        },
      );
    },
  };
}

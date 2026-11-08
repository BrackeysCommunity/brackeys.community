import { fileURLToPath } from "node:url";

import * as hocuspocus from "@hocuspocus/server";
import { sceneCollabServer, type FileProject } from "@jams/engine/vite";

import { discoverProjects } from "./projects";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Discovered while the module loads: the config's module runner, which
// imports each project's game module, is closed once the import returns.
const projects: FileProject[] = await discoverProjects(ROOT);

/**
 * `VITE_BUILD_AT` as ms since the epoch, read exactly as the browser reads
 * it: digits, or a date `Date.parse` reads; anything else is 0. Left out,
 * the server stamps the time it started.
 */
export function buildAtOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const text = raw.trim();
  if (text === "") return 0;
  const at = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
  return Number.isFinite(at) && at > 0 ? at : 0;
}

/**
 * The dev server's collab server over every project under the repo: each
 * `jams.project.json` with its game, its registries and its dev cache.
 * `buildAt` is the build stamp the site's code carries, so the server's
 * stamps and the browser's agree.
 */
export function devSceneCollab(opts: { buildAt?: string } = {}) {
  const buildAt = buildAtOf(opts.buildAt);
  return sceneCollabServer({ projects, hocuspocus, ...(buildAt === undefined ? {} : { buildAt }) });
}

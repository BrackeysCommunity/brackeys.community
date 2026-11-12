import { fileURLToPath } from "node:url";

import { readFileProject } from "@jams/engine/vite";

import { discoverProjects } from "../../../projects";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/**
 * Each project's kind schema hashes as the dev collab server stamps them: its
 * game imported by the project scan, its registries from `@jams/engine/vite`.
 * Computed while the module loads, as `dev-sink.ts` discovers its projects,
 * since the runner closes once the import returns.
 */
export const devSchemaHashes: Record<string, Record<string, string>> = {};
for (const handle of await discoverProjects(ROOT)) {
  const project = await readFileProject(handle.dir, { game: handle.game });
  devSchemaHashes[handle.file.id] = {
    ...(await project.kinds.schemaHashes({ registry: project.registry, project: null })),
  };
}

import { fileURLToPath } from "node:url";

import type { ToolContext } from "./context";
import { discoverProjects } from "./projects";
import { loadCompatRapier } from "./rapier-compat";

/** The repository root, where `discoverProjects` looks for `jams.project.json` files. */
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Every project in the repo, with Rapier's `-compat` build: what the CLI and the MCP server run with. */
export async function defaultToolContext(): Promise<ToolContext> {
  return {
    projects: await discoverProjects(REPO_ROOT),
    loadRapier: loadCompatRapier,
    rapierFlavour: "rapier2d-compat",
  };
}

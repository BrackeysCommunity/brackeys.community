import type { ToolContext } from "./context";
import { GAMES, gameSchemaFiles, gameScenesDirs } from "./games";
import { loadCompatRapier } from "./rapier-compat";

/** The repo's games, scenes directories and schema files, with Rapier's `-compat` build: what the CLI and the MCP server run with. */
export function defaultToolContext(): ToolContext {
  return {
    games: GAMES,
    scenesDirs: gameScenesDirs(GAMES),
    schemaFiles: gameSchemaFiles(GAMES),
    loadRapier: loadCompatRapier,
  };
}

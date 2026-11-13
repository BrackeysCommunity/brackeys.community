/**
 * The engine's test helpers that games' tests share, reached as
 * `@jams/engine-testing` (a tsconfig alias, never published).
 */
export { projectInput } from "./fixtures/held-project";
export {
  migrationHarness,
  type MigrationHarnessOptions,
} from "../scene/__tests__/fixtures/migration-harness";

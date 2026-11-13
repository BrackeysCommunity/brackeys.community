/**
 * The engine's test helpers that games' tests share, reached as
 * `@jams/engine-testing` (a tsconfig alias, never published).
 */
import type { ExportInput } from "../export/plan";
import { buildSceneVersion, sceneVersionOptions } from "../project/scene-version";
import { formatScene } from "../scene/format";
import type { SceneDefinition } from "../scene/types";
import type { StagedVersion } from "../types";

export { projectInput } from "./fixtures/held-project";
export {
  migrationHarness,
  type MigrationHarnessOptions,
} from "../scene/__tests__/fixtures/migration-harness";

/**
 * A version of `scene` built from the project's files as `game live build`
 * builds one, the scene's text replaced by `def` when given; throws on any issue.
 */
export async function editedSceneVersion(
  input: ExportInput,
  scene: string,
  def?: SceneDefinition,
): Promise<StagedVersion> {
  const texts = new Map(input.texts);
  if (def) texts.set(scene, formatScene(def).text);
  const built = await buildSceneVersion(sceneVersionOptions(input, scene, { texts }));
  if (!built.ok) throw new Error(JSON.stringify(built.issues, null, 2));
  return built;
}

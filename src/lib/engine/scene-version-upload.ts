import {
  beginSceneVersion,
  commitSceneVersion,
  type BeginSceneInput,
  type BeginSceneResult,
} from "./live-upload";
import { putReleaseFile, type Actor, type ReleaseDeps } from "./release-upload";

/** What a scene version carries besides its own text: its doc texts, by hash. */
export type SceneVersionTexts = { texts: ReadonlyMap<string, string> };

/** Sends the texts a scene upload's begin listed as missing. */
export async function putSceneTexts(
  deps: ReleaseDeps,
  version: SceneVersionTexts,
  begun: Pick<BeginSceneResult, "uploadId" | "missing">,
  actor: Actor,
): Promise<void> {
  for (const { sha256 } of begun.missing) {
    const text = version.texts.get(sha256);
    if (text === undefined) throw new Error(`the version doesn't carry the text ${sha256}`);
    await putReleaseFile(deps, {
      uploadId: begun.uploadId,
      sha256,
      body: new TextEncoder().encode(text),
      actor,
    });
  }
}

/**
 * A scene version uploaded and committed as the CLI and the editor's
 * Publish scene do it: begin with `input`, every missing text from
 * `version`, then commit.
 */
export async function uploadSceneVersion(
  deps: ReleaseDeps,
  input: BeginSceneInput,
  version: SceneVersionTexts,
) {
  const begun = await beginSceneVersion(deps, input);
  await putSceneTexts(deps, version, begun, input.actor);
  const committed = await commitSceneVersion(deps, {
    uploadId: begun.uploadId,
    actor: input.actor,
  });
  return { begun, committed };
}

import { isSha256 } from "@jams/engine/project";
import * as z from "zod";

import {
  blockSceneVersion as block,
  hideSceneVersion as hide,
  reportLiveOutcome,
  sceneVersionQueue,
  unblockSceneVersion as unblock,
  unhideSceneVersion as unhide,
} from "@/lib/engine/live-moderation";
import { LIVE_ISSUE_CODE, LIVE_OUTCOMES } from "@/lib/engine/live-outcomes";
import {
  liveBeginInput,
  liveClearInput,
  livePromoteInput,
  liveRollbackInput,
} from "@/lib/engine/live-routes";
import {
  beginSceneVersion as begin,
  commitSceneVersion as commit,
  type BeginSceneResult,
  type CommitSceneResult,
} from "@/lib/engine/live-upload";
import {
  clearScene,
  getSceneVersion as getVersion,
  listSceneVersions as listVersions,
  liveBase,
  promoteScene,
  rollbackScene,
} from "@/lib/engine/live-versions";
import {
  engineProjectIdInput as projectId,
  moderationReasonInput as reason,
  sceneIdInput as scene,
  versionNumberInput as number,
} from "@/lib/engine/projects";
import { releaseChannel as channel } from "@/lib/engine/release-access";
import { orpcRefusals } from "@/lib/engine/release-errors";
import { uploadIdInput } from "@/lib/engine/route-gate";

import { gameReader } from "./engine-game";
import { actorOf, deps, releaseStaff } from "./engine-release";

/**
 * A hosted game's live scene versions: the upload, the pointers that put
 * a version on a channel, blocking and staff's hides, and the outcomes
 * play pages report. Management is staff only behind `engine-games-enabled`
 * and the production guard; `report` follows the play page's gate. Each
 * procedure parses its input, names the caller and calls one function in
 * `@/lib/engine`, which owns the rules.
 */

export type {
  LiveBase,
  LiveChannel,
  SceneVersionDetail,
  SceneVersionFile,
  SceneVersionPointer,
  SceneVersionSummary,
} from "@/lib/engine/live-versions";

export type { SceneVersionQueueItem } from "@/lib/engine/live-moderation";

const sha256 = z.string().refine(isSha256, "A SHA-256 is 64 lowercase hex digits.");

/** Checks a scene version against its channel's release and every quota, and lists the texts the site doesn't hold yet. */
export const beginSceneVersion = releaseStaff
  .input(liveBeginInput.extend({ projectId }))
  .handler(
    ({ context, input }): Promise<BeginSceneResult> =>
      orpcRefusals(() => begin(deps(), { ...input, actor: actorOf(context) })),
  );

/** Records the version once its texts have arrived, and moves preview to it unless the upload said not to. */
export const commitSceneVersion = releaseStaff
  .input(uploadIdInput)
  .handler(
    ({ context, input }): Promise<CommitSceneResult> =>
      orpcRefusals(() => commit(deps(), { ...input, actor: actorOf(context) })),
  );

/** Points a channel's scene at a version; the timing defaults to the next load. */
export const promoteSceneVersion = releaseStaff
  .input(livePromoteInput.extend({ projectId, scene, number }))
  .handler(({ context, input }) =>
    orpcRefusals(() => promoteScene(deps(), { ...input, actor: actorOf(context) })),
  );

/** Back to the scene's previous pointer on the channel (or the release's scene), or to version `to`. */
export const rollbackSceneVersion = releaseStaff
  .input(liveRollbackInput.extend({ projectId, scene }))
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      rollbackScene(deps(), {
        projectId: input.projectId,
        scene: input.scene,
        channel: input.channel,
        ...(input.to !== undefined ? { to: input.to } : {}),
        ...(input.timing !== undefined ? { timing: input.timing } : {}),
        actor: actorOf(context),
      }),
    ),
  );

/** "Stop": the channel plays the release's own scene again, at the pointer's timing. */
export const clearSceneVersion = releaseStaff
  .input(liveClearInput.extend({ projectId, scene }))
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      clearScene(deps(), {
        projectId: input.projectId,
        scene: input.scene,
        channel: input.channel,
        ...(input.timing !== undefined ? { timing: input.timing } : {}),
        actor: actorOf(context),
      }),
    ),
  );

/** Newest first; one scene's with `scene`. */
export const listSceneVersions = releaseStaff
  .input(z.object({ projectId, scene: scene.optional() }))
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      listVersions({
        projectId: input.projectId,
        ...(input.scene !== undefined ? { scene: input.scene } : {}),
        actor: actorOf(context),
      }),
    ),
  );

export const getSceneVersion = releaseStaff
  .input(z.object({ projectId, scene, number }))
  .handler(({ context, input }) =>
    orpcRefusals(() => getVersion({ ...input, actor: actorOf(context) })),
  );

/** For the editor's Publish scene checks. */
export const getLiveBase = releaseStaff
  .input(z.object({ projectId, scene, channel }))
  .handler(({ context, input }) =>
    orpcRefusals(() => liveBase({ ...input, actor: actorOf(context) }, deps())),
  );

/** Stops every channel from playing a version until it is unblocked; production's needs a publisher. */
export const blockSceneVersion = releaseStaff
  .input(z.object({ projectId, scene, number, reason: reason.optional() }))
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      block({
        projectId: input.projectId,
        scene: input.scene,
        number: input.number,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        actor: actorOf(context),
      }),
    ),
  );

/** Lets a blocked version play again; the breaker counts afresh. */
export const unblockSceneVersion = releaseStaff
  .input(z.object({ projectId, scene, number }))
  .handler(({ context, input }) =>
    orpcRefusals(() => unblock({ ...input, actor: actorOf(context) })),
  );

/** Staff's hide: the version's files go and pages running it reload. */
export const hideSceneVersion = releaseStaff
  .input(z.object({ projectId, scene, number, reason }))
  .handler(({ context, input }) => orpcRefusals(() => hide({ ...input, actor: actorOf(context) })));

export const unhideSceneVersion = releaseStaff
  .input(z.object({ projectId, scene, number, reason }))
  .handler(({ context, input }) =>
    orpcRefusals(() => unhide({ ...input, actor: actorOf(context) })),
  );

/** Scene versions across projects for staff's queue: reported, blocked or hidden first. */
export const listSceneVersionQueue = releaseStaff
  .input(z.object({ includeHidden: z.boolean().default(false) }))
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      sceneVersionQueue({ includeHidden: input.includeHidden, actor: actorOf(context) }),
    ),
  );

/** A play page's report of what its frame did with a version, once per version per page load. */
export const reportLiveState = gameReader
  .input(
    z.object({
      projectId,
      versionId: sha256,
      channel,
      outcome: z.enum(LIVE_OUTCOMES),
      issueCode: z.string().regex(LIVE_ISSUE_CODE).optional(),
    }),
  )
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      reportLiveOutcome({
        projectId: input.projectId,
        versionId: input.versionId,
        channel: input.channel,
        outcome: input.outcome,
        ...(input.issueCode !== undefined ? { issueCode: input.issueCode } : {}),
        userId: context.user.id,
      }),
    ),
  );

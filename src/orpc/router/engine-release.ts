import { ID_PATTERN } from "@jams/engine/scene";
import { os } from "@orpc/server";
import * as z from "zod";

import { assertEngineGames } from "@/lib/engine/guard-server";
import { RELEASE_MANIFEST_MAX_BYTES } from "@/lib/engine/limits";
import { engineProjectIdInput as projectId } from "@/lib/engine/projects";
import { releaseChannel as channel } from "@/lib/engine/release-access";
import {
  getRelease as readRelease,
  listReleases as readReleases,
  promote,
  rollback,
} from "@/lib/engine/release-channels";
import { orpcRefusals } from "@/lib/engine/release-errors";
import { linkJam, unlinkJam } from "@/lib/engine/release-jam-links";
import {
  approvePublic,
  hideRelease as hide,
  moderationQueue,
  resolveReport,
  unhideRelease as unhide,
} from "@/lib/engine/release-moderation";
import { minioReleaseStore } from "@/lib/engine/release-storage";
import {
  beginRelease as begin,
  commitRelease as commit,
  type Actor,
} from "@/lib/engine/release-upload";
import { uploadIdInput } from "@/lib/engine/route-gate";
import { requireStaff } from "@/orpc/middleware/auth";

/**
 * A hosted project's releases: the upload, its channels, its jam versions
 * and staff's hides. Staff only, and behind `engine-games-enabled` and the
 * production guard, which every procedure checks. Each parses its input,
 * names the caller and calls one function in `@/lib/engine`, which owns
 * the rules.
 */
export const releaseStaff = os.use(requireStaff).use(async ({ context, next }) => {
  await assertEngineGames({ userId: context.user.id });
  return next();
});

const version = z.number().int().min(1);

const person = (userId: string): Actor => ({ kind: "user", userId });
const staff = (userId: string): Actor => ({ kind: "staff", userId });
/** The caller as their audit rows name them: staff by their roles, else the person. */
export const actorOf = (context: { user: { id: string }; isStaff: boolean }): Actor =>
  context.isStaff ? staff(context.user.id) : person(context.user.id);
export const deps = () => ({ store: minioReleaseStore });

/** Checks a build's `release.json` and every quota, and lists the files the site doesn't hold yet. */
export const beginRelease = releaseStaff
  .input(
    z.object({
      projectId,
      manifest: z.string().max(RELEASE_MANIFEST_MAX_BYTES),
      channel: z.enum(["preview", "none"]).default("preview"),
    }),
  )
  .handler(({ context, input }) =>
    orpcRefusals(() => begin(deps(), { ...input, actor: actorOf(context) })),
  );

/** Records the release once its files have arrived, and moves preview to it unless the upload said not to. */
export const commitRelease = releaseStaff
  .input(uploadIdInput)
  .handler(({ context, input }) =>
    orpcRefusals(() => commit(deps(), { ...input, actor: actorOf(context) })),
  );

export const listReleases = releaseStaff
  .input(z.object({ projectId }))
  .handler(({ context, input }) =>
    orpcRefusals(() => readReleases({ ...input, actor: actorOf(context) })),
  );

export const getRelease = releaseStaff
  .input(z.object({ projectId, version }))
  .handler(({ context, input }) =>
    orpcRefusals(() => readRelease({ ...input, actor: actorOf(context) })),
  );

const scene = z.string().regex(ID_PATTERN, "A scene id is lowercase letters, digits and dashes.");

/** Points a channel at a release; its live scenes go but `keepScenes`, which a publisher may keep. */
export const promoteRelease = releaseStaff
  .input(z.object({ projectId, version, channel, keepScenes: z.array(scene).optional() }))
  .handler(({ context, input }) =>
    orpcRefusals(() => promote({ ...input, actor: actorOf(context) })),
  );

/** Back to the channel's previous release, or to the kept version `to`, with the live scenes it put back and those it couldn't. */
export const rollbackRelease = releaseStaff
  .input(z.object({ projectId, channel, to: version.optional() }))
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      rollback({
        projectId: input.projectId,
        channel: input.channel,
        ...(input.to !== undefined ? { to: input.to } : {}),
        actor: actorOf(context),
      }),
    ),
  );

export const linkReleaseJam = releaseStaff
  .input(z.object({ projectId, version, jamId: z.number().int().min(1) }))
  .handler(({ context, input }) =>
    orpcRefusals(() => linkJam({ ...input, actor: actorOf(context) })),
  );

export const unlinkReleaseJam = releaseStaff
  .input(z.object({ projectId, jamId: z.number().int().min(1) }))
  .handler(({ context, input }) =>
    orpcRefusals(() => unlinkJam({ ...input, actor: actorOf(context) })),
  );

/** Hides one version, or the whole game without one, with the reason its publishers see. */
export const hideRelease = releaseStaff
  .input(
    z.object({ projectId, version: version.optional(), reason: z.string().trim().min(1).max(500) }),
  )
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      hide({
        projectId: input.projectId,
        reason: input.reason,
        ...(input.version !== undefined ? { version: input.version } : {}),
        actor: staff(context.user.id),
      }),
    ),
  );

export const unhideRelease = releaseStaff
  .input(z.object({ projectId, version: version.optional() }))
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      unhide({
        projectId: input.projectId,
        ...(input.version !== undefined ? { version: input.version } : {}),
        actor: staff(context.user.id),
      }),
    ),
  );

/** Staff's one-time review that lets the game go public. */
export const approveGamePublic = releaseStaff
  .input(z.object({ projectId }))
  .handler(({ context, input }) =>
    orpcRefusals(() => approvePublic({ ...input, actor: staff(context.user.id) })),
  );

/** Open game reports (with the latest resolved ones on request), public reviews and what's hidden. */
export const listGameModerationQueue = releaseStaff
  .input(z.object({ includeResolved: z.boolean().default(false) }))
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      moderationQueue({ includeResolved: input.includeResolved, actor: staff(context.user.id) }),
    ),
  );

/** Hides a report's release or whole project with a reason, or dismisses it. */
export const resolveGameReport = releaseStaff
  .input(
    z.object({
      reportId: z.number().int().min(1),
      action: z.enum(["hide-release", "hide-project", "dismiss"]),
      reason: z.string().trim().min(1).max(500).optional(),
    }),
  )
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      resolveReport({
        reportId: input.reportId,
        action: input.action,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        actor: staff(context.user.id),
      }),
    ),
  );

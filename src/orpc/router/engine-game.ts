import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import * as z from "zod";

import { createShowcase, linkShowcase, unlinkShowcase } from "@/lib/engine/engine-showcase";
import { gamePage } from "@/lib/engine/game-page";
import { resolvePlay } from "@/lib/engine/game-play";
import { readGameSettings, setGameSettings as writeSettings } from "@/lib/engine/game-settings";
import { assertEngineGames } from "@/lib/engine/guard-server";
import { CONNECT_ORIGINS_MAX } from "@/lib/engine/limits";
import { isEngineProjectId } from "@/lib/engine/projects";
import { orpcRefusals } from "@/lib/engine/release-errors";
import { reportGame as fileReport } from "@/lib/engine/release-moderation";
import type { Actor } from "@/lib/engine/release-upload";
import { viewerOf } from "@/lib/engine/viewer";
import { requireStaff } from "@/orpc/middleware/auth";

/**
 * A hosted game's pages and settings. Every procedure is staff only and
 * behind `engine-games-enabled` and the production guard; inside that,
 * the game's audience rules still decide what a viewer may play or see.
 */
const gameStaff = os.use(requireStaff).use(async ({ context, next }) => {
  await assertEngineGames({ userId: context.user.id });
  return next();
});

const NOT_FOUND = (reason?: string) =>
  new ORPCError("NOT_FOUND", { message: "Not found.", ...(reason ? { data: { reason } } : {}) });

/**
 * `gameStaff` for the play and game pages, where a caller the staff gate
 * refuses reads as not found, the same as a missing game or a closed site.
 */
const gameReader = os
  .use(async ({ next }) => {
    let admitted = false;
    try {
      return await next({ context: { admit: () => void (admitted = true) } });
    } catch (error) {
      const refused =
        error instanceof ORPCError && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN");
      if (!admitted && refused) throw NOT_FOUND();
      throw error;
    }
  })
  .use(requireStaff)
  .use(async ({ context, next }) => {
    context.admit();
    await assertEngineGames({ userId: context.user.id });
    return next();
  });

const projectId = z
  .string()
  .refine(isEngineProjectId, "A project id is lowercase letters, digits and dashes.");

const person = (userId: string): Actor => ({ kind: "user", userId });

/** The play page's frame and release for `latest`, `preview` or a version number. */
export const getGamePlay = gameReader
  .input(z.object({ projectId, version: z.string().regex(/^(latest|preview|[1-9]\d{0,8})$/) }))
  .handler(async ({ context, input }) => {
    const viewer = await viewerOf(context.user.id, input.projectId);
    const resolved = await orpcRefusals(() => resolvePlay({ ...input, viewer }));
    if (!resolved.ok) throw NOT_FOUND(resolved.reason);
    return resolved.play;
  });

/** The game page as this viewer may see it. */
export const getGamePage = gameReader
  .input(z.object({ projectId }))
  .handler(async ({ context, input }) => {
    const viewer = await viewerOf(context.user.id, input.projectId);
    const page = await orpcRefusals(() => gamePage({ ...input, viewer }));
    if (!page) throw NOT_FOUND();
    return page;
  });

export const linkGameShowcase = gameStaff
  .input(z.object({ projectId, showcaseProjectId: z.string().min(1).max(64) }))
  .handler(({ context, input }) =>
    orpcRefusals(() => linkShowcase({ ...input, actor: person(context.user.id) })),
  );

export const createGameShowcase = gameStaff
  .input(z.object({ projectId }))
  .handler(({ context, input }) =>
    orpcRefusals(() => createShowcase({ ...input, actor: person(context.user.id) })),
  );

export const unlinkGameShowcase = gameStaff
  .input(z.object({ projectId }))
  .handler(({ context, input }) =>
    orpcRefusals(() => unlinkShowcase({ ...input, actor: person(context.user.id) })),
  );

/** The settings `setGameSettings` changes, as it answers with them. */
export const getGameSettings = gameStaff
  .input(z.object({ projectId }))
  .handler(({ context, input }) =>
    orpcRefusals(() =>
      readGameSettings({ projectId: input.projectId, actor: person(context.user.id) }),
    ),
  );

/** Visibility, where saves go, the origins the frame may reach, and whether it goes online. */
export const setGameSettings = gameStaff
  .input(
    z.object({
      projectId,
      visibility: z.enum(["private", "team", "unlisted", "public"]).optional(),
      saveMode: z.enum(["site", "own", "none"]).optional(),
      connectOrigins: z.array(z.string().max(255)).max(CONNECT_ORIGINS_MAX).optional(),
      online: z.boolean().optional(),
    }),
  )
  .handler(({ context, input }) => {
    const { projectId: id, ...patch } = input;
    return orpcRefusals(() =>
      writeSettings({ projectId: id, patch, actor: person(context.user.id) }),
    );
  });

/** A signed-in player's report on a game or one of its versions. */
export const reportGame = gameStaff
  .input(
    z.object({
      projectId,
      version: z.number().int().min(1).optional(),
      reason: z.string().trim().min(1).max(1000),
    }),
  )
  .handler(({ context, input }) => {
    return orpcRefusals(() =>
      fileReport({
        projectId: input.projectId,
        reason: input.reason,
        ...(input.version !== undefined ? { version: input.version } : {}),
        reporterId: context.user.id,
      }),
    );
  });

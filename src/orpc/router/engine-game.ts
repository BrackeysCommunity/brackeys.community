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
import { authMiddleware, requireStaff } from "@/orpc/middleware/auth";

/**
 * A hosted game's pages and settings. Playing, the game page and reports
 * are open to anyone the game's audience admits, signed in or not; the
 * rest are staff only. Every procedure is behind `engine-games-enabled`
 * and the production guard.
 */
const gameReader = os.use(authMiddleware).use(async ({ context, next }) => {
  await assertEngineGames({ userId: context.user?.id ?? null });
  return next();
});

const gameStaff = os.use(requireStaff).use(async ({ context, next }) => {
  await assertEngineGames({ userId: context.user.id });
  return next();
});

const projectId = z
  .string()
  .refine(isEngineProjectId, "A project id is lowercase letters, digits and dashes.");

const person = (userId: string): Actor => ({ kind: "user", userId });

const NOT_FOUND = (reason?: string) =>
  new ORPCError("NOT_FOUND", { message: "Not found.", ...(reason ? { data: { reason } } : {}) });

/** The play page's frame and release for `latest`, `preview` or a version number. */
export const getGamePlay = gameReader
  .input(z.object({ projectId, version: z.string().regex(/^(latest|preview|[1-9]\d{0,8})$/) }))
  .handler(async ({ context, input }) => {
    const viewer = await viewerOf(context.user?.id ?? null, input.projectId);
    const resolved = await orpcRefusals(() => resolvePlay({ ...input, viewer }));
    if (!resolved.ok) throw NOT_FOUND(resolved.reason);
    return resolved.play;
  });

/** The game page as this viewer may see it. */
export const getGamePage = gameReader
  .input(z.object({ projectId }))
  .handler(async ({ context, input }) => {
    const viewer = await viewerOf(context.user?.id ?? null, input.projectId);
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
export const reportGame = gameReader
  .input(
    z.object({
      projectId,
      version: z.number().int().min(1).optional(),
      reason: z.string().trim().min(1).max(1000),
    }),
  )
  .handler(({ context, input }) => {
    const reporterId = context.user?.id;
    if (!reporterId) {
      throw new ORPCError("UNAUTHORIZED", { message: "Sign in to report a game." });
    }
    return orpcRefusals(() =>
      fileReport({
        projectId: input.projectId,
        reason: input.reason,
        ...(input.version !== undefined ? { version: input.version } : {}),
        reporterId,
      }),
    );
  });

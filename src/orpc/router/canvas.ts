import { ORPCError } from "@orpc/client";
import { call, os } from "@orpc/server";
import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import * as Y from "yjs";
import * as z from "zod";

import { db } from "@/db";
import {
  canvasAttachments,
  canvasDocs,
  canvasDocVersions,
  canvases,
  canvasMembers,
  canvasOpens,
  canvasReports,
  developerProfiles,
  forumPosts,
  itchJams,
  profileUrlStubs,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { siteUrl } from "@/env";
import { isActiveBan } from "@/lib/ban-state";
import { type CanvasEventScope, emitCanvasEvent } from "@/lib/canvas-events";
import {
  bytea,
  CanvasGoneError,
  CanvasStateError,
  CanvasUpdateError,
  EMPTY_STATE,
  readCanvasState,
  importIntoCanvasState,
  type Recheck,
  updateCanvasState,
} from "@/lib/canvas-persistence";
import { publishCanvasApply } from "@/lib/canvas-sync-publish";
import {
  atLeast,
  canSetVisibility,
  visibilityOpenness,
  canvasAccess,
  type CanvasAccess,
  type CanvasAccessViewer,
} from "@/lib/canvas/access";
import {
  docFromState,
  mergeStates,
  missingFrom,
  restoreCanvasInto,
  stateVectorOf,
} from "@/lib/canvas/doc-state";
import { base64ToBytes, bytesToBase64 } from "@/lib/canvas/encoding";
import {
  applyJsonCanvas,
  canvasNodeKey,
  canvasNodes,
  deriveSnapshot,
  ENTITY_KINDS,
  type EntityKind,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import {
  checkPath,
  PATH_PROBLEM_MESSAGES,
  pathKey,
  pathTitle,
  repairPath,
} from "@/lib/canvas/paths";
import { documentName } from "@/lib/canvas/sync-channels";
import { canvasThumbnail } from "@/lib/canvas/thumbnail";
import { signCanvasToken, type SyncAccess } from "@/lib/canvas/token";
import { isStaffMember } from "@/lib/discord";
import { EVENTS } from "@/lib/event-taxonomy";
import { forumPostParam, forumPostTitle } from "@/lib/forum-posts";
import { NOT_GUILD_MEMBER_MESSAGE } from "@/lib/guild-gate";
import { jamSlug } from "@/lib/jam-links";
import { memberAvatarUrl, memberDisplayName, memberName } from "@/lib/member-name";
import { recordModerationAction } from "@/lib/moderation-audit";
import { notify } from "@/lib/notifications";
import { isUniqueViolation } from "@/lib/pg-errors";
import { bestEffort, captureServerEvent, isServerFlagEnabled } from "@/lib/posthog-server";
import { censorText } from "@/lib/profanity";
import { profileSlug } from "@/lib/profile-links";
import { getProfileProjectImageUrl } from "@/lib/profile-project-image-storage";
import { assertRateLimit } from "@/lib/rate-limit";
import { notifyReporters, resolveReportsForSubject } from "@/lib/report-resolution";
import { resolveUserRoles } from "@/lib/staff-roles";
import { touchTeamActivity } from "@/lib/team-activity";
import { teamSlug } from "@/lib/team-links";
import { blockPairExists } from "@/lib/user-blocks";
import { requireStaff, userIsGuildMember } from "@/orpc/middleware/auth";
import { canvasPublic, canvasRead, canvasSignedIn } from "@/orpc/middleware/canvas";
import { profileIdentityColumns, profileStubJoin } from "@/orpc/profile-projection";

const canvasScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("personal") }),
  z.object({ kind: z.literal("team"), teamId: z.string().min(1) }),
]);
export type Scope = z.infer<typeof canvasScopeSchema>;

/** A Yjs update or state vector, base64. The cap is the state cap plus base64's overhead. */
const bytesSchema = z
  .string()
  .max(Math.ceil((CANVAS_LIMITS.maxStateBytes * 4) / 3) + 4)
  .transform((value, ctx) => {
    try {
      return base64ToBytes(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Not base64." });
      return z.NEVER;
    }
  });

const canvasIdSchema = z.string().min(1).max(100);

const NOT_FOUND = () => new ORPCError("NOT_FOUND", { message: "Canvas not found." });

// ── Access ───────────────────────────────────────────────────────────────────

const canvasColumns = {
  id: canvases.id,
  ownerId: canvases.ownerId,
  teamId: canvases.teamId,
  path: canvases.path,
  visibility: canvases.visibility,
  nodeCount: canvases.nodeCount,
  byteSize: canvases.byteSize,
  lastEditedById: canvases.lastEditedById,
  lastEditedAt: canvases.lastEditedAt,
  hiddenAt: canvases.hiddenAt,
  hiddenReason: canvases.hiddenReason,
  deletedAt: canvases.deletedAt,
  createdAt: canvases.createdAt,
  updatedAt: canvases.updatedAt,
};

type CanvasRow = { [K in keyof typeof canvasColumns]: (typeof canvases.$inferSelect)[K] };

async function viewerFlags(userId: string | null) {
  if (!userId) return { isStaff: false, isGuildMember: false };
  const [roles, isGuildMember] = await Promise.all([
    resolveUserRoles(userId),
    userIsGuildMember(userId),
  ]);
  return { isStaff: isStaffMember(roles), isGuildMember };
}

type ViewerFlags = Awaited<ReturnType<typeof viewerFlags>>;

/** Everything `canvasAccess` needs about one viewer and one canvas. */
async function viewerFor(
  canvas: CanvasRow,
  userId: string | null,
  read: Pick<typeof db, "select"> = db,
  flags?: ViewerFlags,
): Promise<CanvasAccessViewer> {
  const [resolved, team, teamRole, memberRole] = await Promise.all([
    flags ?? viewerFlags(userId),
    canvas.teamId
      ? read
          .select({ status: teams.status, hiddenAt: teams.hiddenAt })
          .from(teams)
          .where(eq(teams.id, canvas.teamId))
          .then(([row]) => row ?? null)
      : null,
    canvas.teamId && userId
      ? read
          .select({ role: teamMembers.role })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, canvas.teamId), eq(teamMembers.userId, userId)))
          .then(([row]) => (row?.role as "owner" | "member" | undefined) ?? null)
      : null,
    !canvas.teamId && userId
      ? read
          .select({ role: canvasMembers.role })
          .from(canvasMembers)
          .where(and(eq(canvasMembers.canvasId, canvas.id), eq(canvasMembers.userId, userId)))
          .then(([row]) => (row?.role as "editor" | "viewer" | undefined) ?? null)
      : null,
  ]);
  return { userId, team, teamRole, memberRole, ...resolved };
}

function accessAtLeast(
  canvas: CanvasRow,
  viewer: CanvasAccessViewer,
  needed: Exclude<CanvasAccess, null>,
): Exclude<CanvasAccess, null> {
  const access = canvasAccess(canvas, viewer);
  if (!access) throw NOT_FOUND();
  if (!atLeast(access, needed)) {
    throw new ORPCError("FORBIDDEN", {
      message:
        needed === "owner"
          ? "Only the canvas's owner can do that."
          : "You can only view this canvas.",
    });
  }
  return access;
}

/**
 * The canvas and the viewer's access to it, refusing with NOT_FOUND below
 * `needed`, so a canvas you can't see is indistinguishable from none.
 */
async function loadCanvas(
  canvasId: string,
  userId: string | null,
  needed: Exclude<CanvasAccess, null>,
): Promise<{
  canvas: CanvasRow;
  access: Exclude<CanvasAccess, null>;
  isStaff: boolean;
  viewer: CanvasAccessViewer;
}> {
  const [canvas] = await db.select(canvasColumns).from(canvases).where(eq(canvases.id, canvasId));
  if (!canvas) throw NOT_FOUND();
  const viewer = await viewerFor(canvas, userId);
  const access = accessAtLeast(canvas, viewer, needed);
  return { canvas, access, isStaff: viewer.isStaff ?? false, viewer };
}

/**
 * `loadCanvas` again inside a state write, once it holds the doc's row lock,
 * with the canvas row locked too: a delete, hide, archive or role change that
 * landed while the write waited refuses it the same way. The staff and guild
 * flags carry over from the first check.
 */
async function reloadUnderLock(
  tx: Pick<typeof db, "select">,
  canvasId: string,
  first: CanvasAccessViewer,
  needed: Exclude<CanvasAccess, null>,
) {
  const [canvas] = await tx
    .select(canvasColumns)
    .from(canvases)
    .where(eq(canvases.id, canvasId))
    .for("update");
  if (!canvas) throw NOT_FOUND();
  const viewer = await viewerFor(canvas, first.userId, tx, {
    isStaff: first.isStaff ?? false,
    isGuildMember: first.isGuildMember ?? false,
  });
  return { canvas, access: accessAtLeast(canvas, viewer, needed), viewer };
}

function stillWritable(canvasId: string, viewer: CanvasAccessViewer): Recheck {
  return async (tx) => assertLive((await reloadUnderLock(tx, canvasId, viewer, "write")).canvas);
}

/**
 * History is for the canvas's writers, and restoring for its owners; staff
 * can do both on any canvas they can see, which is how a vandalised canvas
 * gets put back.
 */
async function loadForHistory(canvasId: string, userId: string, needed: "write" | "owner") {
  const loaded = await loadCanvas(canvasId, userId, "read");
  assertHistoryAccess(loaded, needed);
  return loaded;
}

function assertHistoryAccess(
  loaded: { access: Exclude<CanvasAccess, null>; isStaff: boolean },
  needed: "write" | "owner",
): void {
  if (loaded.isStaff || atLeast(loaded.access, needed)) return;
  throw new ORPCError("FORBIDDEN", {
    message:
      needed === "owner"
        ? "Only the canvas's owner can do that."
        : "You can only view this canvas.",
  });
}

function assertLive(canvas: CanvasRow): void {
  if (canvas.deletedAt) {
    throw new ORPCError("BAD_REQUEST", { message: "Restore this canvas before editing it." });
  }
}

/**
 * What the viewer may do in a scope as a whole: create in it, list it. A
 * personal scope is always the viewer's own.
 */
export async function canvasScopeAccess(scope: Scope, userId: string): Promise<CanvasAccess> {
  if (scope.kind === "personal") {
    const { isGuildMember } = await viewerFlags(userId);
    return isGuildMember ? "owner" : "read";
  }
  const [row] = await db
    .select({ role: teamMembers.role, status: teams.status, hiddenAt: teams.hiddenAt })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.teamId, scope.teamId), eq(teamMembers.userId, userId)));
  if (!row) return null;
  return canvasAccess(
    { ownerId: null, teamId: scope.teamId, visibility: "team", hiddenAt: null, deletedAt: null },
    {
      userId,
      teamRole: row.role as "owner" | "member",
      team: { status: row.status, hiddenAt: row.hiddenAt },
      ...(await viewerFlags(userId)),
    },
  );
}

function scopeWhere(scope: Scope, userId: string) {
  return scope.kind === "personal"
    ? and(isNull(canvases.teamId), eq(canvases.ownerId, userId))
    : eq(canvases.teamId, scope.teamId);
}

function toScope(canvas: Pick<CanvasRow, "teamId">): Scope {
  return canvas.teamId ? { kind: "team", teamId: canvas.teamId } : { kind: "personal" };
}

function validPath(path: string): string {
  const checked = checkPath(path, "canvas");
  if (!checked.ok)
    throw new ORPCError("BAD_REQUEST", { message: PATH_PROBLEM_MESSAGES[checked.problem] });
  return checked.path;
}

function pathTaken(): ORPCError<"CONFLICT", unknown> {
  return new ORPCError("CONFLICT", { message: "Something with that name is already there." });
}

function stateError(error: unknown): never {
  if (error instanceof CanvasStateError) {
    throw new ORPCError("PAYLOAD_TOO_LARGE", { message: error.message });
  }
  if (error instanceof CanvasUpdateError) {
    throw new ORPCError("BAD_REQUEST", { message: error.message });
  }
  if (error instanceof CanvasGoneError) throw NOT_FOUND();
  throw error;
}

/** A state vector that can't be read is refused before anything is stored. */
function readableVector(vector: Uint8Array): Uint8Array {
  try {
    Y.decodeStateVector(vector);
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "That state vector couldn't be read." });
  }
  return vector;
}

function eventScope(canvas: Pick<CanvasRow, "teamId" | "ownerId">): CanvasEventScope {
  return canvas.teamId
    ? { kind: "team", teamId: canvas.teamId }
    : { kind: "personal", ownerId: canvas.ownerId };
}

function isOpenVisibility(visibility: string): boolean {
  return visibility === "public" || visibility === "unlisted";
}

/** The owner, an invited member or someone on the team: people who don't report their own canvas. */
function isRelated(canvas: Pick<CanvasRow, "ownerId">, viewer: CanvasAccessViewer): boolean {
  return canvas.ownerId === viewer.userId || viewer.memberRole != null || viewer.teamRole != null;
}

/**
 * What the shell offers this viewer: Share for the owner of a live canvas,
 * the visibility picker for its owner and (narrowing only) a team canvas's
 * editors, Leave for an invited member, Report for a signed-in stranger
 * reading a public or unlisted one.
 */
function sharingFlags(
  canvas: CanvasRow,
  access: Exclude<CanvasAccess, null>,
  viewer: CanvasAccessViewer,
) {
  const live = !canvas.deletedAt && !canvas.hiddenAt && !viewer.team?.hiddenAt;
  const related = isRelated(canvas, viewer);
  return {
    memberRole: viewer.memberRole ?? null,
    isMember: viewer.memberRole != null,
    canShare: access === "owner" && live,
    canChangeVisibility:
      live && (access === "owner" || (canvas.teamId != null && access === "write")),
    canWidenVisibility: access === "owner" && live,
    canReport: viewer.userId != null && live && isOpenVisibility(canvas.visibility) && !related,
  };
}

function summary(canvas: CanvasRow) {
  return {
    id: canvas.id,
    path: canvas.path,
    title: pathTitle(canvas.path),
    scope: toScope(canvas),
    visibility: canvas.visibility,
    nodeCount: canvas.nodeCount,
    lastEditedById: canvas.lastEditedById,
    lastEditedAt: canvas.lastEditedAt,
    hidden: canvas.hiddenAt != null,
    deletedAt: canvas.deletedAt,
    updatedAt: canvas.updatedAt,
  };
}

// ── Scopes and listings ──────────────────────────────────────────────────────

/** Where the viewer can keep canvases: their personal scope, then each team. */
export const listCanvasScopes = os
  .use(canvasSignedIn)
  .input(z.object({}))
  .handler(async ({ context }) => {
    const rows = await db
      .select({
        teamId: teams.id,
        slug: teams.slug,
        name: teams.name,
        role: teamMembers.role,
        status: teams.status,
        hiddenAt: teams.hiddenAt,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, context.user.id))
      .orderBy(asc(teams.name));
    return {
      teams: rows.map(({ hiddenAt, ...row }) => ({ ...row, hidden: hiddenAt != null })),
    };
  });

/**
 * A scope's canvases, or its recently deleted ones. Paths carry the
 * folders; the client builds the tree with `folderTree`.
 */
export const listCanvases = os
  .use(canvasSignedIn)
  .input(
    z.object({
      scope: canvasScopeSchema,
      deleted: z.boolean().default(false),
      /** Adds each canvas's thumbnail; costs a snapshot read per row. */
      thumbnails: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).optional(),
      orderBy: z.enum(["path", "edited"]).default("path"),
    }),
  )
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    if (!(await canvasScopeAccess(input.scope, userId))) throw NOT_FOUND();

    const rows = await db
      .select({
        ...canvasColumns,
        snapshot: input.thumbnails ? canvases.snapshot : sql<null>`null`,
      })
      .from(canvases)
      .where(
        and(
          scopeWhere(input.scope, userId),
          input.deleted ? isNotNull(canvases.deletedAt) : isNull(canvases.deletedAt),
        ),
      )
      .orderBy(
        input.orderBy === "edited"
          ? sql`${canvases.lastEditedAt} DESC NULLS LAST, ${canvases.updatedAt} DESC`
          : asc(canvases.pathKey),
      )
      .limit(input.limit ?? 500);

    const viewer = rows[0] ? await viewerFor(rows[0], userId) : null;
    return rows
      .filter((row) => viewer && canvasAccess(row, viewer))
      .map((row) => ({
        ...summary(row),
        thumbnail: row.snapshot ? canvasThumbnail(row.snapshot) : null,
      }));
  });

/** The viewer's last ten opened canvases they can still reach. */
export const listRecentCanvases = os
  .use(canvasSignedIn)
  .input(z.object({ scope: canvasScopeSchema.optional() }))
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const rows = await db
      .select({ ...canvasColumns, openedAt: canvasOpens.openedAt })
      .from(canvasOpens)
      .innerJoin(canvases, eq(canvases.id, canvasOpens.docId))
      .where(
        and(
          eq(canvasOpens.userId, userId),
          eq(canvasOpens.docKind, "canvas"),
          isNull(canvases.deletedAt),
          input.scope ? scopeWhere(input.scope, userId) : undefined,
        ),
      )
      .orderBy(desc(canvasOpens.openedAt))
      .limit(20);

    const recent = [];
    for (const row of rows) {
      if (recent.length === 10) break;
      if (canvasAccess(row, await viewerFor(row, userId))) {
        recent.push({ ...summary(row), openedAt: row.openedAt });
      }
    }
    return recent;
  });

// ── One canvas ───────────────────────────────────────────────────────────────

/**
 * Metadata, the viewer's access, and the snapshot for first paint. Editors
 * also get the Yjs state to hydrate from.
 */
export const getCanvas = os
  .use(canvasRead)
  .input(z.object({ canvasId: canvasIdSchema }))
  .handler(async ({ context, input }) => {
    const userId = context.user?.id ?? null;
    const { canvas, access, isStaff, viewer } = await loadCanvas(input.canvasId, userId, "read");
    const [row] = await db
      .select({ snapshot: canvases.snapshot })
      .from(canvases)
      .where(eq(canvases.id, canvas.id));
    if (!row) throw NOT_FOUND();

    const editable = atLeast(access, "write") && !canvas.deletedAt;
    const state = editable ? bytesToBase64(await readCanvasState(canvas.id)) : null;

    if (userId && !canvas.deletedAt) {
      void bestEffort("canvas.recordOpen", { canvasId: canvas.id }, () =>
        db
          .insert(canvasOpens)
          .values({ userId, docKind: "canvas", docId: canvas.id })
          .onConflictDoUpdate({
            target: [canvasOpens.userId, canvasOpens.docKind, canvasOpens.docId],
            set: { openedAt: sql`now()` },
          }),
      );
    }

    const snapshot = row.snapshot as JsonCanvas;
    return {
      ...summary(canvas),
      hiddenReason: access === "read" && canvas.hiddenAt ? canvas.hiddenReason : null,
      access,
      canModerate: isStaff,
      ...sharingFlags(canvas, access, viewer),
      snapshot,
      state,
      attachments: await attachmentsFor(canvas, imageAttachmentIds(snapshot)),
    };
  });

/**
 * A short-lived token for `canvas-sync`, minted only after the same access
 * check every other procedure makes; the service trusts nothing else. The
 * service's URL rides along, so the browser bundle needs no per-environment
 * build. NOT_FOUND while live canvases are off for the caller, which the
 * editor reads as "stay on the solo save".
 */
export const getCanvasSyncToken = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema }))
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    if (!(await isServerFlagEnabled("canvases-multiplayer", userId))) throw NOT_FOUND();
    const { canvas, access } = await loadCanvas(input.canvasId, userId, "read");
    assertLive(canvas);
    const secret = process.env.CANVAS_SYNC_SECRET;
    const url = process.env.CANVAS_SYNC_URL;
    if (!secret || !url) {
      throw new ORPCError("PRECONDITION_FAILED", { message: "Live canvases aren't set up here." });
    }
    const syncAccess: SyncAccess = atLeast(access, "write") ? "write" : "read";
    const token = await signCanvasToken(
      { c: documentName("canvas", canvas.id), u: userId, a: syncAccess },
      secret,
    );
    return { token, url, access: syncAccess };
  });

export const createCanvas = os
  .use(canvasSignedIn)
  .input(
    z.object({
      scope: canvasScopeSchema,
      path: z.string().max(1_024),
      /** A Yjs update to start from: an import, a duplicate, a template. */
      initialState: bytesSchema.optional(),
      source: z
        .enum(["blank", "obsidian_canvas", "obsidian_zip", "obsidian_folder", "duplicate"])
        .default("blank"),
    }),
  )
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const access = await canvasScopeAccess(input.scope, userId);
    if (!access) throw NOT_FOUND();
    if (!atLeast(access, "write")) {
      const { isGuildMember } = await viewerFlags(userId);
      throw new ORPCError("FORBIDDEN", {
        message: isGuildMember ? "This team's canvases are read-only." : NOT_GUILD_MEMBER_MESSAGE,
      });
    }
    const path = validPath(input.path);

    if (input.scope.kind === "personal") {
      const [{ count }] = (await db
        .select({ count: sql<number>`count(*)::int` })
        .from(canvases)
        .where(and(scopeWhere(input.scope, userId), isNull(canvases.deletedAt)))) as [
        { count: number },
      ];
      if (count >= CANVAS_LIMITS.maxPersonalCanvases) {
        throw new ORPCError("BAD_REQUEST", {
          message: `You can keep up to ${CANVAS_LIMITS.maxPersonalCanvases} personal canvases.`,
        });
      }
    }

    const teamId = input.scope.kind === "team" ? input.scope.teamId : null;
    let id: string;
    try {
      id = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(canvases)
          .values({ ownerId: userId, teamId, path, visibility: teamId ? "team" : "private" })
          .returning({ id: canvases.id });
        await tx.insert(canvasDocs).values({ canvasId: row!.id, state: bytea(EMPTY_STATE) });
        return row!.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw pathTaken();
      throw error;
    }

    if (input.initialState) {
      const initial = input.initialState;
      try {
        await updateCanvasState(id, userId, (stored) => mergeStates(stored, initial));
      } catch (error) {
        await db.delete(canvases).where(eq(canvases.id, id));
        stateError(error);
      }
    }

    void touchTeamActivity(teamId);
    captureServerEvent(EVENTS.canvasCreated, userId, {
      canvas_id: id,
      source: input.source,
      as_team: teamId != null,
    });
    return { id, path };
  });

/**
 * The solo editor's persistence. The update merges into what's stored (so
 * two tabs never lose each other's work), and the reply carries whatever
 * this tab is missing, diffed against the state vector it sent.
 */
export const saveCanvas = os
  .use(canvasSignedIn)
  .input(
    z.object({
      canvasId: canvasIdSchema,
      update: bytesSchema,
      stateVector: bytesSchema,
    }),
  )
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const { canvas, viewer } = await loadCanvas(input.canvasId, userId, "write");
    assertLive(canvas);
    const vector = readableVector(input.stateVector);

    const state = await updateCanvasState(
      canvas.id,
      userId,
      (stored) => mergeStates(stored, input.update),
      { recheck: stillWritable(canvas.id, viewer) },
    ).catch(stateError);
    // Someone may have it open live; the service loads what was just stored.
    void publishCanvasApply(canvas.id);

    if (canvas.teamId) void touchTeamActivity(canvas.teamId);
    return {
      update: bytesToBase64(missingFrom(state, vector)),
      stateVector: bytesToBase64(stateVectorOf(state)),
    };
  });

/**
 * An import into an open canvas, solo or live. The tab sends what it holds
 * (`base`) and the import's own update, not yet applied anywhere; the
 * server keeps a `pre-import` version, checks the caps against the merged
 * result under the row lock, stores it and tells canvas-sync.
 * `stateVector` is the tab's once the import lands, so the reply carries
 * only other people's edits, not the import again. Over a cap the whole
 * import is refused and nothing changes.
 */
export const saveCanvasImport = os
  .use(canvasSignedIn)
  .input(
    z.object({
      canvasId: canvasIdSchema,
      base: bytesSchema,
      update: bytesSchema,
      stateVector: bytesSchema,
    }),
  )
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const { canvas, viewer } = await loadCanvas(input.canvasId, userId, "write");
    assertLive(canvas);
    const vector = readableVector(input.stateVector);

    const { state, changed } = await importIntoCanvasState(
      canvas.id,
      userId,
      input.base,
      input.update,
      { recheck: stillWritable(canvas.id, viewer) },
    ).catch(stateError);
    if (changed) {
      void publishCanvasApply(canvas.id);
      if (canvas.teamId) void touchTeamActivity(canvas.teamId);
    }
    return {
      update: bytesToBase64(missingFrom(state, vector)),
      stateVector: bytesToBase64(stateVectorOf(state)),
    };
  });

/** Rename or move within the scope: the path is the name, so a rename renames the file. */
export const moveCanvas = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema, path: z.string().max(1_024) }))
  .handler(async ({ context, input }) => {
    const { canvas } = await loadCanvas(input.canvasId, context.user.id, "write");
    assertLive(canvas);
    const path = validPath(input.path);
    try {
      await db
        .update(canvases)
        .set({ path, updatedAt: new Date() })
        .where(eq(canvases.id, canvas.id));
    } catch (error) {
      if (isUniqueViolation(error)) throw pathTaken();
      throw error;
    }
    return { id: canvas.id, path };
  });

/**
 * Soft delete, restorable for 30 days. On a personal canvas only its owner
 * can; on a team canvas any teammate who can write, as in a shared vault.
 */
export const deleteCanvas = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema }))
  .handler(async ({ context, input }) => {
    const { canvas, access } = await loadCanvas(input.canvasId, context.user.id, "write");
    assertLive(canvas);
    if (!canvas.teamId && access !== "owner") {
      throw new ORPCError("FORBIDDEN", { message: "Only the canvas's owner can delete it." });
    }
    await db.update(canvases).set({ deletedAt: new Date() }).where(eq(canvases.id, canvas.id));
    await emitCanvasEvent({ type: "deleted", canvasId: canvas.id, scope: eventScope(canvas) });
    return { id: canvas.id };
  });

/** Undo a delete. If the path was reused meanwhile, the restored canvas is renamed. */
export const restoreCanvas = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema }))
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const { canvas } = await loadCanvas(input.canvasId, userId, "write");
    if (!canvas.deletedAt) return { id: canvas.id, path: canvas.path };

    const restore = (path: string) =>
      db.update(canvases).set({ path, deletedAt: null }).where(eq(canvases.id, canvas.id));
    try {
      await restore(canvas.path);
      await emitCanvasEvent({ type: "restored", canvasId: canvas.id, scope: eventScope(canvas) });
      return { id: canvas.id, path: canvas.path };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const live = await db
      .select({ pathKey: canvases.pathKey })
      .from(canvases)
      .where(
        and(
          scopeWhere(toScope(canvas), canvas.ownerId ?? userId),
          isNull(canvases.deletedAt),
          ne(canvases.id, canvas.id),
        ),
      );
    const taken = new Set(live.map((row) => row.pathKey));
    const path = repairPath(canvas.path, "canvas", (key) => taken.has(key));
    await restore(path);
    await emitCanvasEvent({ type: "restored", canvasId: canvas.id, scope: eventScope(canvas) });
    return { id: canvas.id, path };
  });

// ── Attachments and entity cards ─────────────────────────────────────────────

function imageAttachmentIds(snapshot: JsonCanvas): string[] {
  const ids = new Set<string>();
  for (const node of snapshot.nodes) {
    const key = canvasNodeKey(node);
    if (key?.type === "image") ids.add(key.attachmentId);
  }
  return [...ids];
}

interface CanvasAttachmentView {
  path: string;
  url: string | null;
  quarantined: boolean;
}

/**
 * The attachments an image card can show: only ones in the canvas's own
 * scope, so a card can't borrow another scope's image by id.
 */
async function attachmentsFor(
  canvas: Pick<CanvasRow, "teamId" | "ownerId">,
  ids: string[],
): Promise<Record<string, CanvasAttachmentView>> {
  if (ids.length === 0) return {};
  const rows = await db
    .select({
      id: canvasAttachments.id,
      path: canvasAttachments.path,
      imageKey: canvasAttachments.imageKey,
      quarantinedAt: canvasAttachments.quarantinedAt,
    })
    .from(canvasAttachments)
    .where(
      and(
        inArray(canvasAttachments.id, ids.slice(0, CANVAS_LIMITS.maxNodes)),
        isNull(canvasAttachments.deletedAt),
        canvas.teamId
          ? eq(canvasAttachments.teamId, canvas.teamId)
          : and(
              isNull(canvasAttachments.teamId),
              eq(canvasAttachments.ownerId, canvas.ownerId ?? ""),
            ),
      ),
    );
  const out: Record<string, CanvasAttachmentView> = {};
  for (const row of rows) {
    out[row.id] = {
      path: row.path,
      url: row.quarantinedAt ? null : await getProfileProjectImageUrl(row.imageKey),
      quarantined: row.quarantinedAt != null,
    };
  }
  return out;
}

/** Image cards that arrived after load (another tab's, a restore's). */
export const listCanvasAttachments = os
  .use(canvasRead)
  .input(
    z.object({ canvasId: canvasIdSchema, attachmentIds: z.array(z.string().max(100)).max(500) }),
  )
  .handler(async ({ context, input }) => {
    const { canvas } = await loadCanvas(input.canvasId, context.user?.id ?? null, "read");
    return attachmentsFor(canvas, input.attachmentIds);
  });

/**
 * Which of an import's images the scope already holds: by the attachment
 * id an image card's key names, or by the sha256 of the bytes it would
 * upload. Only live attachments in the scope count, so re-importing an
 * export uploads nothing and never borrows another scope's image.
 */
export const listCanvasAttachmentMatches = os
  .use(canvasSignedIn)
  .input(
    z.object({
      scope: canvasScopeSchema,
      attachmentIds: z.array(z.string().max(100)).max(2_000),
      sha256s: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(2_000),
    }),
  )
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const access = await canvasScopeAccess(input.scope, userId);
    if (!access) throw NOT_FOUND();
    if (!atLeast(access, "write")) {
      throw new ORPCError("FORBIDDEN", { message: "You can't add images here." });
    }
    const byId: Record<string, { path: string; sha256: string }> = {};
    const bySha: Record<string, { id: string; path: string }> = {};
    if (input.attachmentIds.length === 0 && input.sha256s.length === 0) return { byId, bySha };

    const inScope =
      input.scope.kind === "team"
        ? eq(canvasAttachments.teamId, input.scope.teamId)
        : and(isNull(canvasAttachments.teamId), eq(canvasAttachments.ownerId, userId));
    const wanted = [
      input.attachmentIds.length ? inArray(canvasAttachments.id, input.attachmentIds) : undefined,
      input.sha256s.length ? inArray(canvasAttachments.sha256, input.sha256s) : undefined,
    ].filter((c) => c !== undefined);
    const rows = await db
      .select({
        id: canvasAttachments.id,
        path: canvasAttachments.path,
        sha256: canvasAttachments.sha256,
      })
      .from(canvasAttachments)
      .where(and(inScope, isNull(canvasAttachments.deletedAt), or(...wanted)))
      .orderBy(asc(canvasAttachments.createdAt), asc(canvasAttachments.id));

    const ids = new Set(input.attachmentIds);
    const shas = new Set(input.sha256s);
    for (const row of rows) {
      if (ids.has(row.id)) byId[row.id] = { path: row.path, sha256: row.sha256 };
      // The oldest copy wins, so every import lands on the same one.
      if (shas.has(row.sha256) && !bySha[row.sha256])
        bySha[row.sha256] = { id: row.id, path: row.path };
    }
    return { byId, bySha };
  });

const entityRefSchema = z.object({ kind: z.enum(ENTITY_KINDS), id: z.string().min(1).max(100) });

interface CanvasEntityView {
  kind: EntityKind;
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  href: string;
}

const entityKey = (kind: string, id: string) => `${kind}:${id}`;

/**
 * What a live card shows for each jam, team, member or forum post on a
 * canvas, batched. Anything the viewer couldn't open on its own page (a
 * hidden team, an unpublished post) comes back missing, and the card says
 * so instead.
 */
export const getCanvasEntities = os
  .use(canvasRead)
  .input(z.object({ refs: z.array(entityRefSchema).max(200) }))
  .handler(async ({ context, input }) => {
    const viewer = { inGuild: (await viewerFlags(context.user?.id ?? null)).isGuildMember };
    const ids = (kind: EntityKind) => [
      ...new Set(input.refs.filter((r) => r.kind === kind).map((r) => r.id)),
    ];
    const jamIds = ids("jam").map(Number).filter(Number.isInteger);
    const teamIds = ids("team");
    const profileIds = ids("profile");
    const postIds = ids("forum-post").map(Number).filter(Number.isInteger);

    const [jamRows, teamRows, profileRows, postRows] = await Promise.all([
      jamIds.length
        ? db
            .select({
              jamId: itchJams.jamId,
              slug: itchJams.slug,
              title: itchJams.title,
              bannerUrl: itchJams.bannerUrl,
              endsAt: itchJams.endsAt,
            })
            .from(itchJams)
            .where(inArray(itchJams.jamId, jamIds))
        : [],
      teamIds.length
        ? db
            .select({
              id: teams.id,
              slug: teams.slug,
              name: teams.name,
              tagline: teams.tagline,
              avatarUrl: teams.avatarUrl,
            })
            .from(teams)
            .where(and(inArray(teams.id, teamIds), isNull(teams.hiddenAt)))
        : [],
      profileIds.length
        ? db
            .select({
              id: developerProfiles.id,
              tagline: developerProfiles.tagline,
              ...profileIdentityColumns,
            })
            .from(developerProfiles)
            .leftJoin(profileUrlStubs, profileStubJoin)
            .where(inArray(developerProfiles.id, profileIds))
        : [],
      postIds.length
        ? db
            .select({
              id: forumPosts.id,
              title: forumPosts.title,
              excerpt: forumPosts.excerpt,
              kind: forumPosts.kind,
            })
            .from(forumPosts)
            .where(
              and(
                inArray(forumPosts.id, postIds),
                eq(forumPosts.status, "published"),
                isNull(forumPosts.hiddenAt),
                isNull(forumPosts.deletedAt),
              ),
            )
        : [],
    ]);

    const found = new Map<string, CanvasEntityView>();
    for (const jam of jamRows) {
      found.set(entityKey("jam", String(jam.jamId)), {
        kind: "jam",
        id: String(jam.jamId),
        title: jam.title,
        subtitle: jam.endsAt
          ? `Ends ${jam.endsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
          : null,
        imageUrl: jam.bannerUrl,
        href: `/jams/${jamSlug(jam)}`,
      });
    }
    for (const team of teamRows) {
      found.set(entityKey("team", team.id), {
        kind: "team",
        id: team.id,
        title: team.name,
        subtitle: team.tagline,
        imageUrl: team.avatarUrl,
        href: `/teams/${teamSlug(team)}`,
      });
    }
    for (const profile of profileRows) {
      found.set(entityKey("profile", profile.id), {
        kind: "profile",
        id: profile.id,
        title: memberDisplayName(profile, viewer, "Member"),
        subtitle: profile.tagline,
        imageUrl: memberAvatarUrl(profile, viewer),
        href: `/profile/${profileSlug({ id: profile.id, urlStub: profile.urlStub })}`,
      });
    }
    for (const post of postRows) {
      found.set(entityKey("forum-post", String(post.id)), {
        kind: "forum-post",
        id: String(post.id),
        title: forumPostTitle(post),
        subtitle:
          post.kind === "devlog" ? "Devlog" : post.kind === "question" ? "Question" : "Forum post",
        imageUrl: null,
        href: `/forum/${forumPostParam(post)}`,
      });
    }
    return input.refs.map((ref) => found.get(entityKey(ref.kind, ref.id)) ?? null);
  });

// ── Plan this jam ────────────────────────────────────────────────────────────

/**
 * Opens the scope's plan canvas for a jam, creating it the first time at
 * `<jam title>/Plan.canvas`, seeded with the jam's card and a deadline.
 */
export const openJamPlanCanvas = os
  .use(canvasSignedIn)
  .input(z.object({ jamId: z.number().int(), scope: canvasScopeSchema }))
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const [jam] = await db
      .select({
        jamId: itchJams.jamId,
        slug: itchJams.slug,
        title: itchJams.title,
        endsAt: itchJams.endsAt,
      })
      .from(itchJams)
      .where(eq(itchJams.jamId, input.jamId));
    if (!jam) throw new ORPCError("NOT_FOUND", { message: "Jam not found." });

    const path = repairPath(`${jam.title.replaceAll("/", "-")}/Plan`, "canvas");
    const [existing] = await db
      .select({ id: canvases.id })
      .from(canvases)
      .where(
        and(
          scopeWhere(input.scope, userId),
          isNull(canvases.deletedAt),
          sql`${canvases.pathKey} = lower(normalize(${path}, NFC))`,
        ),
      );
    if (existing) {
      await loadCanvas(existing.id, userId, "read");
      return { id: existing.id, created: false };
    }

    const doc = new Y.Doc();
    const deadline = jam.endsAt
      ? jam.endsAt.toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }) + " UTC"
      : "not announced yet";
    applyJsonCanvas(
      doc,
      {
        nodes: [
          {
            id: "jam",
            type: "link",
            url: siteUrl(`/jams/${jamSlug(jam)}`),
            x: 0,
            y: 0,
            width: 360,
            height: 220,
            jamsTeam: { type: "entity", entity: { kind: "jam", id: String(jam.jamId) } },
          },
          {
            id: "deadline",
            type: "text",
            text: `## ${jam.title}\n\n**Deadline:** ${deadline}\n\n**Theme:** `,
            x: 400,
            y: 0,
            width: 320,
            height: 220,
            color: "4",
          },
          { id: "ideas", type: "group", label: "Ideas", x: 0, y: 280, width: 720, height: 360 },
          { id: "idea", type: "text", text: "First idea", x: 30, y: 330, width: 240, height: 80 },
        ],
        edges: [],
      },
      { mode: "whole" },
    );
    const initialState = bytesToBase64(Y.encodeStateAsUpdate(doc));
    doc.destroy();

    const created = await call(
      createCanvas,
      { scope: input.scope, path, initialState, source: "blank" },
      { context },
    );
    return { id: created.id, created: true };
  });

// ── Versions ─────────────────────────────────────────────────────────────────

export const listCanvasVersions = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema }))
  .handler(async ({ context, input }) => {
    const { canvas, access, isStaff } = await loadForHistory(
      input.canvasId,
      context.user.id,
      "write",
    );
    const rows = await db
      .select({
        id: canvasDocVersions.id,
        takenAt: canvasDocVersions.takenAt,
        reason: canvasDocVersions.reason,
        byteSize: canvasDocVersions.byteSize,
      })
      .from(canvasDocVersions)
      .where(and(eq(canvasDocVersions.docKind, "canvas"), eq(canvasDocVersions.docId, canvas.id)))
      .orderBy(desc(canvasDocVersions.takenAt));
    return { versions: rows, canRestore: (access === "owner" || isStaff) && !canvas.deletedAt };
  });

async function loadVersion(canvasId: string, versionId: number): Promise<Uint8Array> {
  const [row] = await db
    .select({ state: canvasDocVersions.state })
    .from(canvasDocVersions)
    .where(
      and(
        eq(canvasDocVersions.id, versionId),
        eq(canvasDocVersions.docKind, "canvas"),
        eq(canvasDocVersions.docId, canvasId),
      ),
    );
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Version not found." });
  return new Uint8Array(row.state);
}

/** A version's contents as JSON Canvas, for the History panel's preview. */
export const getCanvasVersion = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema, versionId: z.number().int() }))
  .handler(async ({ context, input }) => {
    const { canvas } = await loadForHistory(input.canvasId, context.user.id, "write");
    const doc = docFromState(await loadVersion(canvas.id, input.versionId));
    try {
      return { snapshot: deriveSnapshot(doc) };
    } finally {
      doc.destroy();
    }
  });

/**
 * Restores a version as a new edit on top of the current state (the
 * current state is kept as a `pre-restore` version first, or `staff` when
 * staff restore someone else's canvas), so it reaches every open tab and
 * vault like any other change. Pass the caller's state vector to get the
 * edit back straight away.
 */
export const restoreCanvasVersion = os
  .use(canvasSignedIn)
  .input(
    z.object({
      canvasId: canvasIdSchema,
      versionId: z.number().int(),
      stateVector: bytesSchema.optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const { canvas, access, viewer } = await loadForHistory(input.canvasId, userId, "owner");
    assertLive(canvas);
    const versionState = await loadVersion(canvas.id, input.versionId);
    const teamCopies = canvas.teamId ? await teamCopiesFor(versionState, canvas.teamId) : null;

    const state = await updateCanvasState(
      canvas.id,
      userId,
      (stored) => {
        const live = docFromState(stored);
        const version = docFromState(versionState);
        try {
          restoreCanvasInto(live, version, "restore");
          if (teamCopies?.size) repointAttachments(live, teamCopies);
          return Y.encodeStateAsUpdate(live);
        } finally {
          live.destroy();
          version.destroy();
        }
      },
      {
        // A staff restore on someone else's canvas is marked as such in its history.
        versionReason: access === "owner" ? "pre-restore" : "staff",
        recheck: async (tx) => {
          const reloaded = await reloadUnderLock(tx, canvas.id, viewer, "read");
          assertHistoryAccess({ ...reloaded, isStaff: viewer.isStaff ?? false }, "owner");
          assertLive(reloaded.canvas);
        },
      },
    ).catch(stateError);
    void publishCanvasApply(canvas.id);

    if (canvas.teamId) void touchTeamActivity(canvas.teamId);
    return {
      update: input.stateVector ? bytesToBase64(missingFrom(state, input.stateVector)) : null,
      stateVector: bytesToBase64(stateVectorOf(state)),
    };
  });

function attachmentIdsIn(doc: Y.Doc): Set<string> {
  const ids = new Set<string>();
  for (const node of canvasNodes(doc).values()) {
    const id = node.get("attachmentId");
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

function repointAttachments(doc: Y.Doc, ids: Map<string, string>): void {
  doc.transact(() => {
    for (const node of canvasNodes(doc).values()) {
      const next = ids.get(node.get("attachmentId") as string);
      if (next) node.set("attachmentId", next);
    }
  });
}

/**
 * A version saved before the canvas moved into a team names the owner's
 * personal attachments, which a team canvas can't resolve. Maps each to the
 * team's live row for the same stored image (the copy the move made).
 */
async function teamCopiesFor(versionState: Uint8Array, teamId: string) {
  const doc = docFromState(versionState);
  let referenced: string[];
  try {
    referenced = [...attachmentIdsIn(doc)];
  } finally {
    doc.destroy();
  }
  const copies = new Map<string, string>();
  if (referenced.length === 0) return copies;
  const personal = await db
    .select({ id: canvasAttachments.id, imageKey: canvasAttachments.imageKey })
    .from(canvasAttachments)
    .where(and(inArray(canvasAttachments.id, referenced), isNull(canvasAttachments.teamId)));
  if (personal.length === 0) return copies;
  const teamRows = await db
    .select({ id: canvasAttachments.id, imageKey: canvasAttachments.imageKey })
    .from(canvasAttachments)
    .where(
      and(
        eq(canvasAttachments.teamId, teamId),
        isNull(canvasAttachments.deletedAt),
        inArray(
          canvasAttachments.imageKey,
          personal.map((row) => row.imageKey),
        ),
      ),
    )
    .orderBy(asc(canvasAttachments.createdAt));
  const byKey = new Map<string, string>();
  for (const row of teamRows) if (!byKey.has(row.imageKey)) byKey.set(row.imageKey, row.id);
  for (const row of personal) {
    const copy = byKey.get(row.imageKey);
    if (copy) copies.set(row.id, copy);
  }
  return copies;
}

// ── Sharing ──────────────────────────────────────────────────────────────────

const visibilitySchema = z.enum(["private", "team", "unlisted", "public"]);
const memberRoleSchema = z.enum(["editor", "viewer"]);

/** A personal canvas is private to its owner; a team canvas to its roster. */
export function visibilitiesFor(canvas: Pick<CanvasRow, "teamId">): readonly string[] {
  return canvas.teamId ? ["team", "unlisted", "public"] : ["private", "unlisted", "public"];
}

function personalOnly(canvas: CanvasRow): void {
  if (canvas.teamId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Team canvases are shared with the team's roster.",
    });
  }
}

function assertNotHidden(canvas: CanvasRow, viewer: CanvasAccessViewer): void {
  if (canvas.hiddenAt || viewer.team?.hiddenAt) {
    throw new ORPCError("FORBIDDEN", { message: "Staff have hidden this canvas." });
  }
}

/**
 * The owner changes who can see a canvas; a team canvas's editors may only
 * narrow it (see `canSetVisibility`). Hidden canvases stay as staff left them.
 */
export const setCanvasVisibility = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema, visibility: visibilitySchema }))
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const { canvas, access } = await loadCanvas(input.canvasId, userId, "write");
    assertLive(canvas);
    if (!canvas.teamId && access !== "owner") {
      throw new ORPCError("FORBIDDEN", { message: "Only the canvas's owner can do that." });
    }
    if (!visibilitiesFor(canvas).includes(input.visibility)) {
      throw new ORPCError("BAD_REQUEST", {
        message: canvas.teamId
          ? "A team canvas is visible to its team, anyone with the link, or everyone."
          : "A personal canvas is private, visible to anyone with the link, or public.",
      });
    }
    if (canvas.visibility === input.visibility) {
      return { id: canvas.id, visibility: canvas.visibility };
    }
    if (!canSetVisibility(canvas, access, canvas.visibility, input.visibility)) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the team's owners can make this canvas more visible.",
      });
    }

    // Re-check on the write what was checked on the read: a hide, delete,
    // archive or role change landing in between must stop the change.
    const widens = visibilityOpenness(input.visibility) > visibilityOpenness(canvas.visibility);
    const stillAllowed = canvas.teamId
      ? exists(
          db
            .select({ one: sql`1` })
            .from(teamMembers)
            .innerJoin(teams, eq(teams.id, teamMembers.teamId))
            .where(
              and(
                eq(teamMembers.teamId, canvas.teamId),
                eq(teamMembers.userId, userId),
                widens ? eq(teamMembers.role, "owner") : undefined,
                isNull(teams.hiddenAt),
                ne(teams.status, "archived"),
              ),
            ),
        )
      : eq(canvases.ownerId, userId);
    const [updated] = await db
      .update(canvases)
      .set({ visibility: input.visibility, updatedAt: new Date() })
      .where(
        and(
          eq(canvases.id, canvas.id),
          eq(canvases.visibility, canvas.visibility),
          isNull(canvases.hiddenAt),
          isNull(canvases.deletedAt),
          canvas.teamId ? eq(canvases.teamId, canvas.teamId) : isNull(canvases.teamId),
          stillAllowed,
        ),
      )
      .returning({ id: canvases.id });
    if (updated) {
      await emitCanvasEvent({
        type: "visibility_changed",
        canvasId: canvas.id,
        scope: eventScope(canvas),
        from: canvas.visibility,
        to: input.visibility,
      });
      captureServerEvent(EVENTS.canvasVisibilityChanged, userId, {
        canvas_id: canvas.id,
        from: canvas.visibility,
        to: input.visibility,
        as_team: canvas.teamId != null,
      });
      return { id: canvas.id, visibility: input.visibility };
    }
    const [current] = await db
      .select({
        visibility: canvases.visibility,
        teamId: canvases.teamId,
        hiddenAt: canvases.hiddenAt,
        deletedAt: canvases.deletedAt,
      })
      .from(canvases)
      .where(eq(canvases.id, canvas.id));
    if (!current) throw new ORPCError("NOT_FOUND", { message: "Canvas not found." });
    assertLive({ ...canvas, deletedAt: current.deletedAt });
    if (current.hiddenAt) {
      throw new ORPCError("FORBIDDEN", { message: "Staff have hidden this canvas." });
    }
    if (current.teamId !== canvas.teamId) {
      throw new ORPCError("CONFLICT", {
        message: "This canvas moved to a team. Reload and try again.",
      });
    }
    if (current.visibility === canvas.visibility) {
      const [team] = canvas.teamId
        ? await db
            .select({ hiddenAt: teams.hiddenAt, status: teams.status })
            .from(teams)
            .where(eq(teams.id, canvas.teamId))
        : [];
      if (team?.hiddenAt) {
        throw new ORPCError("FORBIDDEN", { message: "Staff have hidden this canvas." });
      }
      throw new ORPCError("FORBIDDEN", {
        message:
          team?.status === "archived"
            ? "This team is archived, so its canvases are read-only."
            : "Your role on this canvas changed. Reload and try again.",
      });
    }
    return { id: canvas.id, visibility: current.visibility };
  });

async function memberCount(canvasId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(canvasMembers)
    .where(eq(canvasMembers.canvasId, canvasId));
  return row?.count ?? 0;
}

/**
 * The people a personal canvas is shared with, for its owner, its members
 * and staff. A team canvas has none: its roster is the access list.
 */
export const listCanvasMembers = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema }))
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const { canvas, viewer, isStaff } = await loadCanvas(input.canvasId, userId, "read");
    if (canvas.teamId) return [];
    if (canvas.ownerId !== userId && viewer.memberRole == null && !isStaff) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only people on this canvas can see who it's shared with.",
      });
    }
    const inGuild = viewer.isGuildMember ?? false;
    const rows = await db
      .select({
        userId: canvasMembers.userId,
        role: canvasMembers.role,
        invitedById: canvasMembers.invitedById,
        createdAt: canvasMembers.createdAt,
        id: developerProfiles.id,
        ...profileIdentityColumns,
        urlStub: profileUrlStubs.stub,
      })
      .from(canvasMembers)
      .leftJoin(developerProfiles, eq(developerProfiles.id, canvasMembers.userId))
      .leftJoin(profileUrlStubs, profileStubJoin)
      .where(eq(canvasMembers.canvasId, canvas.id))
      .orderBy(asc(canvasMembers.createdAt));
    return rows.map((row) => ({
      userId: row.userId,
      role: row.role as "editor" | "viewer",
      invitedById: row.invitedById,
      createdAt: row.createdAt,
      displayName: memberDisplayName(row, { inGuild }, "Member"),
      avatarUrl: memberAvatarUrl(row, { inGuild }),
      slug: profileSlug({ id: row.userId, urlStub: row.urlStub }),
    }));
  });

/**
 * Shares a personal canvas with one member, or changes their role if it
 * already is. A direct grant: there's no invite to accept, the member is
 * told once and can leave whenever they like.
 */
export const addCanvasMember = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema, userId: z.string().min(1), role: memberRoleSchema }))
  .handler(async ({ context, input }) => {
    const ownerId = context.user.id;
    const { canvas } = await loadCanvas(input.canvasId, ownerId, "owner");
    assertLive(canvas);
    personalOnly(canvas);
    if (input.userId === ownerId) {
      throw new ORPCError("BAD_REQUEST", { message: "It's already your canvas." });
    }

    const [target] = await db
      .select({
        id: developerProfiles.id,
        bannedAt: user.bannedAt,
        bannedUntil: user.bannedUntil,
        unbannedAt: user.unbannedAt,
      })
      .from(developerProfiles)
      .innerJoin(user, eq(user.id, developerProfiles.id))
      .where(eq(developerProfiles.id, input.userId));
    if (!target || isActiveBan(target) || (await blockPairExists(ownerId, input.userId))) {
      throw new ORPCError("NOT_FOUND", { message: "Member not found." });
    }

    const memberWhere = and(
      eq(canvasMembers.canvasId, canvas.id),
      eq(canvasMembers.userId, input.userId),
    );
    const [existing] = await db
      .select({ role: canvasMembers.role })
      .from(canvasMembers)
      .where(memberWhere);
    if (existing?.role === input.role) return { userId: input.userId, role: input.role };
    const full = () =>
      new ORPCError("BAD_REQUEST", {
        message: `A canvas can be shared with up to ${CANVAS_LIMITS.maxCanvasMembers} people.`,
      });
    if (!existing && (await memberCount(canvas.id)) >= CANVAS_LIMITS.maxCanvasMembers) {
      throw full();
    }
    await assertRateLimit("canvas-share", ownerId, 60, "Too many shares — try again later.");

    // Whether this call added the row decides between "added" and "role
    // changed", so two concurrent adds announce and notify once.
    const [inserted] = await db
      .insert(canvasMembers)
      .values({ canvasId: canvas.id, userId: input.userId, role: input.role, invitedById: ownerId })
      .onConflictDoNothing()
      .returning({ userId: canvasMembers.userId });

    const scope = eventScope(canvas);
    if (!inserted) {
      const [changed] = await db
        .update(canvasMembers)
        .set({ role: input.role })
        .where(and(memberWhere, ne(canvasMembers.role, input.role)))
        .returning({ userId: canvasMembers.userId });
      if (changed) {
        await emitCanvasEvent({
          type: "member_role_changed",
          canvasId: canvas.id,
          scope,
          userId: input.userId,
          role: input.role,
        });
      }
      return { userId: input.userId, role: input.role };
    }
    // Concurrent adds near the cap can each pass the check above; the one
    // that lands over it backs out.
    if ((await memberCount(canvas.id)) > CANVAS_LIMITS.maxCanvasMembers) {
      await db.delete(canvasMembers).where(memberWhere);
      throw full();
    }

    await emitCanvasEvent({
      type: "member_added",
      canvasId: canvas.id,
      scope,
      userId: input.userId,
      role: input.role,
    });
    await bestEffort("canvas.shareNotice", { canvas_id: canvas.id }, () =>
      notify({
        userId: input.userId,
        type: "canvas_shared_with_you",
        actorId: ownerId,
        entityType: "canvas",
        entityId: canvas.id,
        data: { canvasId: canvas.id, canvasTitle: pathTitle(canvas.path), role: input.role },
      }),
    );
    captureServerEvent(EVENTS.canvasMemberAdded, ownerId, {
      canvas_id: canvas.id,
      role: input.role,
    });
    return { userId: input.userId, role: input.role };
  });

export const updateCanvasMember = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema, userId: z.string().min(1), role: memberRoleSchema }))
  .handler(async ({ context, input }) => {
    const { canvas } = await loadCanvas(input.canvasId, context.user.id, "owner");
    assertLive(canvas);
    personalOnly(canvas);
    const [updated] = await db
      .update(canvasMembers)
      .set({ role: input.role })
      .where(
        and(
          eq(canvasMembers.canvasId, canvas.id),
          eq(canvasMembers.userId, input.userId),
          ne(canvasMembers.role, input.role),
        ),
      )
      .returning({ userId: canvasMembers.userId });
    if (!updated) {
      const [member] = await db
        .select({ role: canvasMembers.role })
        .from(canvasMembers)
        .where(and(eq(canvasMembers.canvasId, canvas.id), eq(canvasMembers.userId, input.userId)));
      if (!member) throw new ORPCError("NOT_FOUND", { message: "Not shared with that member." });
      return { userId: input.userId, role: input.role };
    }
    await emitCanvasEvent({
      type: "member_role_changed",
      canvasId: canvas.id,
      scope: eventScope(canvas),
      userId: input.userId,
      role: input.role,
    });
    return { userId: input.userId, role: input.role };
  });

/**
 * The owner removing someone, or a member leaving (no `userId`, or their
 * own). Taking access away is
 * always allowed to the owner, even when their own write has lapsed (out of
 * the guild, or the canvas hidden), since it only ever narrows who can see it.
 */
export const removeCanvasMember = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema, userId: z.string().min(1).optional() }))
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const memberId = input.userId ?? userId;
    const [canvas] = await db
      .select(canvasColumns)
      .from(canvases)
      .where(eq(canvases.id, input.canvasId));
    if (!canvas || canvas.teamId) throw NOT_FOUND();
    const isOwner = canvas.ownerId === userId;
    if (!isOwner && memberId !== userId) {
      // Indistinguishable from a canvas the caller can't see.
      await loadCanvas(canvas.id, userId, "owner");
    }

    const [removed] = await db
      .delete(canvasMembers)
      .where(and(eq(canvasMembers.canvasId, canvas.id), eq(canvasMembers.userId, memberId)))
      .returning({ userId: canvasMembers.userId });
    if (!removed) {
      if (!isOwner) throw NOT_FOUND();
      throw new ORPCError("NOT_FOUND", { message: "Not shared with that member." });
    }
    await emitCanvasEvent({
      type: "member_removed",
      canvasId: canvas.id,
      scope: eventScope(canvas),
      userId: memberId,
    });
    return { userId: memberId };
  });

/** Personal canvases other members have shared with the viewer. */
export const listSharedCanvases = os
  .use(canvasSignedIn)
  .input(z.object({ thumbnails: z.boolean().default(false) }).default({ thumbnails: false }))
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const rows = await db
      .select({
        ...canvasColumns,
        snapshot: input.thumbnails ? canvases.snapshot : sql<null>`null`,
        role: canvasMembers.role,
        ownerProfileId: developerProfiles.id,
        ...profileIdentityColumns,
        urlStub: profileUrlStubs.stub,
      })
      .from(canvasMembers)
      .innerJoin(canvases, eq(canvases.id, canvasMembers.canvasId))
      .leftJoin(developerProfiles, eq(developerProfiles.id, canvases.ownerId))
      .leftJoin(profileUrlStubs, profileStubJoin)
      .where(
        and(eq(canvasMembers.userId, userId), isNull(canvases.teamId), isNull(canvases.deletedAt)),
      )
      .orderBy(desc(canvases.updatedAt))
      .limit(200);

    const { isGuildMember, isStaff } = await viewerFlags(userId);
    const inGuild = isGuildMember;
    return rows
      .filter((row) =>
        canvasAccess(row, {
          userId,
          memberRole: row.role as "editor" | "viewer",
          isGuildMember,
          isStaff,
        }),
      )
      .map((row) => ({
        ...summary(row),
        role: row.role as "editor" | "viewer",
        thumbnail: row.snapshot ? canvasThumbnail(row.snapshot) : null,
        owner: row.ownerId
          ? {
              id: row.ownerId,
              displayName: memberDisplayName(row, { inGuild }, "Member"),
              avatarUrl: memberAvatarUrl(row, { inGuild }),
              slug: profileSlug({ id: row.ownerId, urlStub: row.urlStub }),
            }
          : null,
      }));
  });

/**
 * Moves a personal canvas into one of the owner's teams. One way only: a
 * move back would silently take the canvas away from the team. Invited
 * members are dropped (the roster is a team canvas's access list), a
 * private canvas becomes team-visible (so does an unlisted or public one
 * unless the mover owns the team), and a name already taken in the team
 * gets a number.
 */
export const moveCanvasToTeam = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema, teamId: z.string().min(1) }))
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const { canvas, viewer } = await loadCanvas(input.canvasId, userId, "owner");
    assertLive(canvas);
    assertNotHidden(canvas, viewer);
    if (canvas.teamId) {
      throw new ORPCError("BAD_REQUEST", { message: "This canvas already belongs to a team." });
    }
    const teamScope = { kind: "team", teamId: input.teamId } as const;
    const teamAccess = await canvasScopeAccess(teamScope, userId);
    if (!teamAccess) throw new ORPCError("NOT_FOUND", { message: "Team not found." });
    if (!atLeast(teamAccess, "write")) {
      throw new ORPCError("FORBIDDEN", { message: "You can't add canvases to that team." });
    }

    const move = () =>
      db.transaction(async (tx) => {
        const [membership] = await tx
          .select({ role: teamMembers.role, status: teams.status, hiddenAt: teams.hiddenAt })
          .from(teamMembers)
          .innerJoin(teams, eq(teams.id, teamMembers.teamId))
          .where(and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, userId)))
          .for("share");
        if (!membership) {
          throw new ORPCError("FORBIDDEN", { message: "You can't add canvases to that team." });
        }
        if (membership.hiddenAt) {
          throw new ORPCError("FORBIDDEN", { message: "Staff have hidden that team." });
        }
        if (membership.status === "archived") {
          throw new ORPCError("FORBIDDEN", {
            message: "That team is archived, so canvases can't be added to it.",
          });
        }
        const [current] = await tx
          .select({ visibility: canvases.visibility })
          .from(canvases)
          .where(eq(canvases.id, canvas.id))
          .for("update");
        if (!current) throw new ORPCError("NOT_FOUND", { message: "Canvas not found." });
        // Making the team's work visible beyond the team is an owner's call
        // (see canSetVisibility), so anyone else brings the canvas in at "team".
        const visibility =
          current.visibility === "private" ||
          (membership.role !== "owner" &&
            visibilityOpenness(current.visibility) > visibilityOpenness("team"))
            ? "team"
            : current.visibility;
        const live = await tx
          .select({ pathKey: canvases.pathKey })
          .from(canvases)
          .where(and(eq(canvases.teamId, input.teamId), isNull(canvases.deletedAt)));
        const taken = new Set(live.map((row) => row.pathKey));
        const path = repairPath(canvas.path, "canvas", (key) => taken.has(key));
        // Guarded on the state checked above, so a delete, hide, visibility
        // change or second move that landed meanwhile isn't overwritten.
        const [moved] = await tx
          .update(canvases)
          .set({ teamId: input.teamId, visibility, path, updatedAt: new Date() })
          .where(
            and(
              eq(canvases.id, canvas.id),
              eq(canvases.visibility, current.visibility),
              isNull(canvases.teamId),
              isNull(canvases.deletedAt),
              isNull(canvases.hiddenAt),
            ),
          )
          .returning({ id: canvases.id });
        if (!moved) {
          throw new ORPCError("CONFLICT", {
            message: "This canvas changed while it was being moved. Reload and try again.",
          });
        }
        const dropped = await tx
          .delete(canvasMembers)
          .where(eq(canvasMembers.canvasId, canvas.id))
          .returning({ userId: canvasMembers.userId });
        const images = await rehomeAttachments(tx, canvas.id, canvas.ownerId, input.teamId);
        const linkTurnedOff =
          visibility === "team" &&
          visibilityOpenness(current.visibility) > visibilityOpenness("team");
        return { path, visibility, linkTurnedOff, dropped, images };
      });
    // A canvas or image created in the team between the read and the write
    // takes the name; the retry picks the next free one.
    let result: Awaited<ReturnType<typeof move>> | undefined;
    for (let attempt = 0; !result; attempt++) {
      try {
        result = await move();
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= 2) throw error;
      }
    }
    const { path, visibility, linkTurnedOff, dropped, images } = result;

    // The image copies were written straight to the stored state; a doc open
    // in canvas-sync loads them before the revoke closes its sockets.
    if (images > 0) await publishCanvasApply(canvas.id);
    const scope = eventScope({ teamId: input.teamId, ownerId: canvas.ownerId });
    await emitCanvasEvent({
      type: "moved_to_team",
      canvasId: canvas.id,
      scope,
      fromOwnerId: canvas.ownerId,
    });
    for (const member of dropped) {
      await emitCanvasEvent({
        type: "member_removed",
        canvasId: canvas.id,
        scope,
        userId: member.userId,
      });
    }
    void touchTeamActivity(input.teamId);
    captureServerEvent(EVENTS.canvasMovedToTeam, userId, {
      canvas_id: canvas.id,
      members_dropped: dropped.length,
      images_copied: images,
    });
    return { id: canvas.id, path, visibility, linkTurnedOff, teamId: input.teamId };
  });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Image cards only resolve attachments in their canvas's own scope, so a
 * canvas moving into a team takes copies of its images along: new rows in
 * the team (the same stored image) and the cards re-pointed at them. The
 * personal rows stay for other canvases still using them. Returns how many
 * images were copied.
 */
async function rehomeAttachments(
  tx: Tx,
  canvasId: string,
  ownerId: string | null,
  teamId: string,
): Promise<number> {
  if (!ownerId) return 0;
  const [stored] = await tx
    .select({ state: canvasDocs.state })
    .from(canvasDocs)
    .where(eq(canvasDocs.canvasId, canvasId))
    .for("update");
  if (!stored) return 0;
  const doc = docFromState(new Uint8Array(stored.state));
  try {
    const referenced = attachmentIdsIn(doc);
    if (referenced.size === 0) return 0;
    const rows = await tx
      .select()
      .from(canvasAttachments)
      .where(
        and(
          inArray(canvasAttachments.id, [...referenced]),
          isNull(canvasAttachments.teamId),
          eq(canvasAttachments.ownerId, ownerId),
          isNull(canvasAttachments.deletedAt),
        ),
      );
    if (rows.length === 0) return 0;

    const taken = new Set(
      (
        await tx
          .select({ key: canvasAttachments.pathKey })
          .from(canvasAttachments)
          .where(and(eq(canvasAttachments.teamId, teamId), isNull(canvasAttachments.deletedAt)))
      ).map((row) => row.key),
    );
    const copies = new Map<string, string>();
    const values = rows.map((row) => {
      const path = repairPath(row.path, "image", (key) => taken.has(key));
      taken.add(pathKey(path));
      const id = crypto.randomUUID();
      copies.set(row.id, id);
      return {
        id,
        ownerId: row.ownerId,
        teamId,
        path,
        imageKey: row.imageKey,
        sha256: row.sha256,
        byteSize: row.byteSize,
        quarantinedAt: row.quarantinedAt,
      };
    });
    await tx.insert(canvasAttachments).values(values);

    repointAttachments(doc, copies);
    const next = Y.encodeStateAsUpdate(doc);
    const snapshot = deriveSnapshot(doc);
    await tx
      .update(canvasDocs)
      .set({ state: bytea(next), updatedAt: new Date() })
      .where(eq(canvasDocs.canvasId, canvasId));
    await tx
      .update(canvases)
      .set({ snapshot, byteSize: next.length })
      .where(eq(canvases.id, canvasId));
    return copies.size;
  } finally {
    doc.destroy();
  }
}

// ── Moderation ───────────────────────────────────────────────────────────────

/**
 * Public and unlisted canvases can be reported by anyone signed in who can
 * read them. Anything else is NOT_FOUND, the same as a canvas that isn't
 * there, so a report can't probe for private canvases.
 */
export const reportCanvas = os
  .use(canvasSignedIn)
  .input(z.object({ canvasId: canvasIdSchema, reason: z.string().trim().min(1).max(1000) }))
  .handler(async ({ context, input }) => {
    const userId = context.user.id;
    const [canvas] = await db
      .select(canvasColumns)
      .from(canvases)
      .where(eq(canvases.id, input.canvasId));
    if (!canvas) throw NOT_FOUND();
    const viewer = await viewerFor(canvas, userId);
    const access = canvasAccess(canvas, viewer);
    if (
      !access ||
      canvas.deletedAt ||
      canvas.hiddenAt ||
      viewer.team?.hiddenAt ||
      !isOpenVisibility(canvas.visibility)
    ) {
      throw NOT_FOUND();
    }
    if (isRelated(canvas, viewer)) {
      throw new ORPCError("BAD_REQUEST", { message: "You can't report a canvas you're on." });
    }

    // No profanity check: a report quotes the abuse it's about.
    const [open] = await db
      .select({ id: canvasReports.id })
      .from(canvasReports)
      .where(
        and(
          eq(canvasReports.canvasId, canvas.id),
          eq(canvasReports.reporterId, userId),
          isNull(canvasReports.resolvedAt),
        ),
      )
      .limit(1);
    if (open) {
      throw new ORPCError("BAD_REQUEST", { message: "You've already reported this canvas." });
    }

    // The same bucket as every other report surface: 10 an hour in total.
    await assertRateLimit("report", userId, 10, "Too many reports — try again later.");

    const [report] = await db
      .insert(canvasReports)
      .values({
        canvasId: canvas.id,
        canvasTitle: pathTitle(canvas.path),
        reporterId: userId,
        reason: input.reason,
      })
      .returning({ id: canvasReports.id });
    captureServerEvent(EVENTS.canvasReported, userId, { canvas_id: canvas.id });
    return { id: report!.id };
  });

/** The first few text cards, censored and flattened, for the report queue. */
function canvasExcerpt(snapshot: { nodes?: unknown }, max = 280): string {
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  const parts: string[] = [];
  let length = 0;
  for (const node of nodes as { type?: unknown; text?: unknown; label?: unknown }[]) {
    const text =
      node.type === "text" && typeof node.text === "string"
        ? node.text
        : node.type === "group" && typeof node.label === "string"
          ? node.label
          : null;
    if (!text) continue;
    const flat = text.replace(/\s+/g, " ").trim();
    if (!flat) continue;
    parts.push(flat);
    length += flat.length;
    if (length >= max) break;
  }
  const joined = censorText(parts.join(" · "));
  return joined.length > max ? `${joined.slice(0, max - 1)}…` : joined;
}

export const listCanvasReports = os
  .use(requireStaff)
  .input(z.object({ includeResolved: z.boolean().default(false) }))
  .handler(async ({ input }) => {
    const rows = await db
      .select({
        id: canvasReports.id,
        canvasId: canvasReports.canvasId,
        canvasTitle: canvasReports.canvasTitle,
        reporterId: canvasReports.reporterId,
        reason: canvasReports.reason,
        createdAt: canvasReports.createdAt,
        resolvedAt: canvasReports.resolvedAt,
        resolvedById: canvasReports.resolvedById,
        // What the canvas is now, beside what was reported, or that it's gone.
        livePath: canvases.path,
        liveVisibility: canvases.visibility,
        liveHiddenAt: canvases.hiddenAt,
        liveDeletedAt: canvases.deletedAt,
        liveTeamId: canvases.teamId,
        liveOwnerId: canvases.ownerId,
        snapshot: canvases.snapshot,
      })
      .from(canvasReports)
      .leftJoin(canvases, eq(canvasReports.canvasId, canvases.id))
      .where(input.includeResolved ? undefined : isNull(canvasReports.resolvedAt))
      .orderBy(sql`${canvasReports.resolvedAt} ASC NULLS FIRST`, desc(canvasReports.createdAt));

    const reporterIds = [...new Set(rows.map((r) => r.reporterId))];
    const profiles =
      reporterIds.length > 0
        ? await db
            .select({
              id: developerProfiles.id,
              discordUsername: developerProfiles.discordUsername,
              guildNickname: developerProfiles.guildNickname,
              avatarUrl: developerProfiles.avatarUrl,
            })
            .from(developerProfiles)
            .where(inArray(developerProfiles.id, reporterIds))
        : [];
    const byId = new Map(
      profiles.map((p) => [
        p.id,
        { id: p.id, displayName: memberName(p, "Member"), avatarUrl: p.avatarUrl },
      ]),
    );

    return rows.map(({ snapshot, livePath, ...row }) => ({
      ...row,
      liveTitle: livePath ? pathTitle(livePath) : null,
      thumbnail: snapshot ? canvasThumbnail(snapshot) : null,
      excerpt: snapshot ? canvasExcerpt(snapshot) : null,
      reporter: byId.get(row.reporterId) ?? null,
    }));
  });

/** Who hears about a staff hide: the personal owner, or the team's owner(s). */
async function canvasOwnerIds(canvas: Pick<CanvasRow, "teamId" | "ownerId">): Promise<string[]> {
  if (!canvas.teamId) return canvas.ownerId ? [canvas.ownerId] : [];
  const roster = await db
    .select({ userId: teamMembers.userId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, canvas.teamId));
  if (canvas.ownerId && roster.some((m) => m.userId === canvas.ownerId)) return [canvas.ownerId];
  return roster.filter((m) => m.role === "owner").map((m) => m.userId);
}

type CanvasModTarget = Pick<CanvasRow, "id" | "teamId" | "ownerId" | "path">;

/**
 * Staff hide, the urgent and reversible tool. A guarded update, so hiding a
 * hidden canvas does nothing; only a real change logs, notifies and is
 * announced. It doesn't resolve reports: closing those is the report's own
 * decision.
 */
export async function applySetCanvasHidden(
  canvas: CanvasModTarget,
  hidden: boolean,
  mod: { actorId: string; reason: string | null },
  extraMetadata: Record<string, unknown> = {},
): Promise<{ success: true; changed: boolean }> {
  const now = new Date();
  const [updated] = await db
    .update(canvases)
    .set(
      hidden
        ? { hiddenAt: now, hiddenById: mod.actorId, hiddenReason: mod.reason, updatedAt: now }
        : { hiddenAt: null, hiddenById: null, hiddenReason: null, updatedAt: now },
    )
    .where(
      and(
        eq(canvases.id, canvas.id),
        hidden ? isNull(canvases.hiddenAt) : isNotNull(canvases.hiddenAt),
      ),
    )
    .returning({ id: canvases.id });
  if (!updated) return { success: true, changed: false };

  const canvasTitle = pathTitle(canvas.path);
  const owners = await canvasOwnerIds(canvas);
  await recordModerationAction({
    action: hidden ? "canvas_hidden" : "canvas_unhidden",
    actorId: mod.actorId,
    targetType: "canvas",
    targetId: canvas.id,
    subjectUserId: owners[0] ?? null,
    reason: mod.reason,
    metadata: { canvasId: canvas.id, canvasTitle, teamId: canvas.teamId, ...extraMetadata },
  });
  for (const ownerId of owners) {
    if (ownerId === mod.actorId) continue;
    await bestEffort("canvas_moderation.owner_notice", { canvas_id: canvas.id }, () =>
      notify({
        userId: ownerId,
        type: hidden ? "canvas_hidden_by_staff" : "canvas_unhidden_by_staff",
        entityType: "canvas",
        entityId: canvas.id,
        data: { canvasId: canvas.id, canvasTitle, ...(mod.reason ? { reason: mod.reason } : {}) },
      }),
    );
  }
  await emitCanvasEvent({
    type: hidden ? "hidden" : "unhidden",
    canvasId: canvas.id,
    scope: eventScope(canvas),
  });
  return { success: true, changed: true };
}

export const setCanvasHidden = os
  .use(requireStaff)
  .input(
    z.object({
      canvasId: canvasIdSchema,
      hidden: z.boolean(),
      reason: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    if (input.hidden && !input.reason) {
      throw new ORPCError("BAD_REQUEST", { message: "A reason is required to hide a canvas." });
    }
    const [canvas] = await db
      .select(canvasColumns)
      .from(canvases)
      .where(eq(canvases.id, input.canvasId));
    if (!canvas) throw NOT_FOUND();
    return applySetCanvasHidden(canvas, input.hidden, {
      actorId: context.user.id,
      reason: input.reason ?? null,
    });
  });

/**
 * Mirrors `resolveTeamReport`: one decision closes every open report on the
 * canvas, each gets its own log row, and each reporter hears once.
 */
export const resolveCanvasReport = os
  .use(requireStaff)
  .input(
    z.object({
      reportId: z.number().int().positive(),
      action: z.enum(["dismiss", "hide_canvas"]),
      /** Recorded in the moderation log and the owner's hide notice. */
      reason: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const actorId = context.user.id;
    const [report] = await db
      .select()
      .from(canvasReports)
      .where(eq(canvasReports.id, input.reportId))
      .limit(1);
    if (!report) throw new ORPCError("NOT_FOUND", { message: "Report not found." });
    if (report.resolvedAt) return { success: true };

    const [canvas] = report.canvasId
      ? await db.select(canvasColumns).from(canvases).where(eq(canvases.id, report.canvasId))
      : [undefined];

    if (input.action === "hide_canvas") {
      if (!canvas) {
        throw new ORPCError("BAD_REQUEST", { message: "That canvas no longer exists." });
      }
      // The owner is told why; the reporter's own words stay with staff.
      if (!input.reason) {
        throw new ORPCError("BAD_REQUEST", { message: "Say why the canvas is being hidden." });
      }
      await applySetCanvasHidden(
        canvas,
        true,
        { actorId, reason: input.reason },
        { reportId: report.id, reportReason: report.reason },
      );
    }

    const resolved = report.canvasId
      ? await resolveReportsForSubject({ kind: "canvas", subjectId: report.canvasId, actorId })
      : await db
          .update(canvasReports)
          .set({ resolvedAt: new Date(), resolvedById: actorId })
          .where(and(eq(canvasReports.id, report.id), isNull(canvasReports.resolvedAt)))
          .returning({ id: canvasReports.id, reporterId: canvasReports.reporterId });

    if (input.action === "dismiss") {
      await recordModerationAction({
        action: "canvas_report_dismissed",
        actorId,
        targetType: "canvas_report",
        targetId: report.id,
        subjectUserId: report.reporterId,
        reason: input.reason,
        metadata: {
          canvasId: report.canvasId,
          canvasTitle: report.canvasTitle,
          reportReason: report.reason,
          ...(resolved.length > 1
            ? { alsoResolved: resolved.filter((r) => r.id !== report.id).map((r) => r.id) }
            : {}),
        },
      });
    }

    for (const sibling of resolved) {
      if (sibling.id === report.id) continue;
      await recordModerationAction({
        action: input.action === "hide_canvas" ? "canvas_hidden" : "canvas_report_dismissed",
        actorId,
        targetType: "canvas_report",
        targetId: sibling.id,
        subjectUserId: sibling.reporterId,
        reason: input.reason,
        metadata: {
          canvasId: report.canvasId,
          canvasTitle: report.canvasTitle,
          resolvedVia: report.id,
        },
      });
    }

    const stillVisible =
      canvas != null &&
      !canvas.hiddenAt &&
      !canvas.deletedAt &&
      isOpenVisibility(canvas.visibility);
    await notifyReporters({
      reports: resolved,
      actorId,
      outcome: input.action === "hide_canvas" ? "actioned" : "no_action",
      entityType: "canvas",
      entityId: report.canvasId ?? report.id,
      subjectTitle: canvas ? pathTitle(canvas.path) : report.canvasTitle,
      subjectUrl:
        input.action === "dismiss" && stillVisible ? `/canvases/${report.canvasId}` : null,
    });

    return { success: true };
  });

// ── Public tier ──────────────────────────────────────────────────────────────

/**
 * What anyone may read without signing in: public and unlisted canvases
 * that aren't hidden or deleted, in a team that isn't hidden. Hidden
 * content can linger at the edge for the TTL (a minute).
 */
function publicWhere(visibilities: string[]) {
  return and(
    inArray(canvases.visibility, visibilities),
    isNull(canvases.hiddenAt),
    isNull(canvases.deletedAt),
    or(isNull(canvases.teamId), isNull(teams.hiddenAt)),
  );
}

const publicCanvasColumns = {
  id: canvases.id,
  path: canvases.path,
  visibility: canvases.visibility,
  nodeCount: canvases.nodeCount,
  updatedAt: canvases.updatedAt,
  ownerId: canvases.ownerId,
  teamId: canvases.teamId,
  teamName: teams.name,
  teamSlug: teams.slug,
};

export const getPublicCanvas = os
  .route({ method: "GET" })
  .use(canvasPublic)
  .input(z.object({ canvasId: canvasIdSchema }))
  .handler(async ({ input }) => {
    const [row] = await db
      .select({ ...publicCanvasColumns, snapshot: canvases.snapshot })
      .from(canvases)
      .leftJoin(teams, eq(teams.id, canvases.teamId))
      .where(and(eq(canvases.id, input.canvasId), publicWhere(["public", "unlisted"])));
    if (!row) throw NOT_FOUND();

    const [owner] =
      !row.teamId && row.ownerId
        ? await db
            .select({
              id: developerProfiles.id,
              ...profileIdentityColumns,
              urlStub: profileUrlStubs.stub,
            })
            .from(developerProfiles)
            .leftJoin(profileUrlStubs, profileStubJoin)
            .where(eq(developerProfiles.id, row.ownerId))
        : [];
    // Caller-independent, so the edge can cache it: names as a signed-out reader sees them.
    const anonymous = { inGuild: false };
    const snapshot = row.snapshot as JsonCanvas;
    return {
      id: row.id,
      path: row.path,
      title: pathTitle(row.path),
      visibility: row.visibility as "public" | "unlisted",
      nodeCount: row.nodeCount,
      updatedAt: row.updatedAt,
      scope: row.teamId
        ? {
            kind: "team" as const,
            teamId: row.teamId,
            name: row.teamName ?? "A team",
            slug: teamSlug({ id: row.teamId, slug: row.teamSlug }),
          }
        : {
            kind: "personal" as const,
            owner: owner
              ? {
                  id: owner.id,
                  displayName: memberDisplayName(owner, anonymous, "Member"),
                  avatarUrl: memberAvatarUrl(owner, anonymous),
                  slug: profileSlug({ id: owner.id, urlStub: owner.urlStub }),
                }
              : null,
          },
      snapshot,
      thumbnail: canvasThumbnail(snapshot),
      attachments: await attachmentsFor(row, imageAttachmentIds(snapshot)),
    };
  });

/** A member's or a team's public canvases, newest first. Never unlisted ones. */
export const listPublicCanvases = os
  .route({ method: "GET" })
  .use(canvasPublic)
  .input(
    z
      .object({
        ownerId: z.string().min(1).optional(),
        teamId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(24).default(12),
      })
      .refine((v) => (v.ownerId == null) !== (v.teamId == null), {
        message: "Pass an ownerId or a teamId.",
      }),
  )
  .handler(async ({ input }) => {
    const rows = await db
      .select({ ...publicCanvasColumns, snapshot: canvases.snapshot })
      .from(canvases)
      .leftJoin(teams, eq(teams.id, canvases.teamId))
      .where(
        and(
          publicWhere(["public"]),
          input.teamId
            ? eq(canvases.teamId, input.teamId)
            : and(isNull(canvases.teamId), eq(canvases.ownerId, input.ownerId!)),
        ),
      )
      .orderBy(desc(canvases.updatedAt))
      .limit(input.limit);
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      title: pathTitle(row.path),
      nodeCount: row.nodeCount,
      updatedAt: row.updatedAt,
      thumbnail: canvasThumbnail(row.snapshot),
    }));
  });

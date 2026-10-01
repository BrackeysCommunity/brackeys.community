import { ORPCError } from "@orpc/client";
import { call, os } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
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
  developerProfiles,
  forumPosts,
  itchJams,
  profileUrlStubs,
  teamMembers,
  teams,
} from "@/db/schema";
import { siteUrl } from "@/env";
import {
  bytea,
  CanvasStateError,
  EMPTY_STATE,
  readCanvasState,
  updateCanvasState,
} from "@/lib/canvas-persistence";
import {
  atLeast,
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
  deriveSnapshot,
  ENTITY_KINDS,
  type EntityKind,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import { checkPath, PATH_PROBLEM_MESSAGES, pathTitle, repairPath } from "@/lib/canvas/paths";
import { canvasThumbnail } from "@/lib/canvas/thumbnail";
import { isStaffMember } from "@/lib/discord";
import { EVENTS } from "@/lib/event-taxonomy";
import { forumPostParam, forumPostTitle } from "@/lib/forum-posts";
import { NOT_GUILD_MEMBER_MESSAGE } from "@/lib/guild-gate";
import { jamSlug } from "@/lib/jam-links";
import { memberAvatarUrl, memberDisplayName } from "@/lib/member-name";
import { isUniqueViolation } from "@/lib/pg-errors";
import { bestEffort, captureServerEvent } from "@/lib/posthog-server";
import { profileSlug } from "@/lib/profile-links";
import { getProfileProjectImageUrl } from "@/lib/profile-project-image-storage";
import { resolveUserRoles } from "@/lib/staff-roles";
import { touchTeamActivity } from "@/lib/team-activity";
import { teamSlug } from "@/lib/team-links";
import { userIsGuildMember } from "@/orpc/middleware/auth";
import { canvasRead, canvasSignedIn } from "@/orpc/middleware/canvas";
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

/** Everything `canvasAccess` needs about one viewer and one canvas. */
async function viewerFor(canvas: CanvasRow, userId: string | null): Promise<CanvasAccessViewer> {
  const [flags, team, teamRole, memberRole] = await Promise.all([
    viewerFlags(userId),
    canvas.teamId
      ? db
          .select({ status: teams.status, hiddenAt: teams.hiddenAt })
          .from(teams)
          .where(eq(teams.id, canvas.teamId))
          .then(([row]) => row ?? null)
      : null,
    canvas.teamId && userId
      ? db
          .select({ role: teamMembers.role })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, canvas.teamId), eq(teamMembers.userId, userId)))
          .then(([row]) => (row?.role as "owner" | "member" | undefined) ?? null)
      : null,
    !canvas.teamId && userId
      ? db
          .select({ role: canvasMembers.role })
          .from(canvasMembers)
          .where(and(eq(canvasMembers.canvasId, canvas.id), eq(canvasMembers.userId, userId)))
          .then(([row]) => (row?.role as "editor" | "viewer" | undefined) ?? null)
      : null,
  ]);
  return { userId, team, teamRole, memberRole, ...flags };
}

/**
 * The canvas and the viewer's access to it, refusing with NOT_FOUND below
 * `needed`, so a canvas you can't see is indistinguishable from none.
 */
async function loadCanvas(
  canvasId: string,
  userId: string | null,
  needed: Exclude<CanvasAccess, null>,
): Promise<{ canvas: CanvasRow; access: Exclude<CanvasAccess, null>; isStaff: boolean }> {
  const [canvas] = await db.select(canvasColumns).from(canvases).where(eq(canvases.id, canvasId));
  if (!canvas) throw NOT_FOUND();
  const viewer = await viewerFor(canvas, userId);
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
  return { canvas, access, isStaff: viewer.isStaff ?? false };
}

/**
 * History is for the canvas's writers, and restoring for its owners; staff
 * can do both on any canvas they can see, which is how a vandalised canvas
 * gets put back.
 */
async function loadForHistory(canvasId: string, userId: string, needed: "write" | "owner") {
  const loaded = await loadCanvas(canvasId, userId, "read");
  if (loaded.isStaff || atLeast(loaded.access, needed)) return loaded;
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
  throw error;
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
    const { canvas, access, isStaff } = await loadCanvas(input.canvasId, userId, "read");
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
      snapshot,
      state,
      attachments: await attachmentsFor(canvas, imageAttachmentIds(snapshot)),
    };
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
    const { canvas } = await loadCanvas(input.canvasId, userId, "write");
    assertLive(canvas);

    const state = await updateCanvasState(canvas.id, userId, (stored) =>
      mergeStates(stored, input.update),
    ).catch(stateError);

    if (canvas.teamId) void touchTeamActivity(canvas.teamId);
    return {
      update: bytesToBase64(missingFrom(state, input.stateVector)),
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
    return { id: canvas.id, path };
  });

// ── Attachments and entity cards ─────────────────────────────────────────────

function imageAttachmentIds(snapshot: JsonCanvas): string[] {
  const ids = new Set<string>();
  for (const node of snapshot.nodes) {
    if (node.brackeys?.type === "image") ids.add(node.brackeys.attachmentId);
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
            brackeys: { type: "entity", entity: { kind: "jam", id: String(jam.jamId) } },
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
    const { canvas, access } = await loadForHistory(input.canvasId, userId, "owner");
    assertLive(canvas);
    const versionState = await loadVersion(canvas.id, input.versionId);

    const state = await updateCanvasState(
      canvas.id,
      userId,
      (stored) => {
        const live = docFromState(stored);
        const version = docFromState(versionState);
        try {
          restoreCanvasInto(live, version, "restore");
          return Y.encodeStateAsUpdate(live);
        } finally {
          live.destroy();
          version.destroy();
        }
      },
      // A staff restore on someone else's canvas is marked as such in its history.
      { versionReason: access === "owner" ? "pre-restore" : "staff" },
    ).catch(stateError);

    if (canvas.teamId) void touchTeamActivity(canvas.teamId);
    return {
      update: input.stateVector ? bytesToBase64(missingFrom(state, input.stateVector)) : null,
      stateVector: bytesToBase64(stateVectorOf(state)),
    };
  });

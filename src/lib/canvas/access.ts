/**
 * Who may do what with a canvas (and, from notes onward, a note). Every
 * procedure and every sync token goes through `canvasAccess`, so this is the
 * one place the rules live. Copied into service images: no `@/` imports.
 */

export type CanvasAccess = "owner" | "write" | "read" | null;

export interface CanvasAccessSubject {
  ownerId: string | null;
  teamId: string | null;
  visibility: string;
  hiddenAt: Date | null;
  deletedAt: Date | null;
}

export interface CanvasAccessViewer {
  /** Null for a signed-out (or banned, which reads as signed-out) viewer. */
  userId: string | null;
  /** The viewer's role on the canvas's team, when it has one. */
  teamRole?: "owner" | "member" | null;
  /** The viewer's invite on a personal canvas. */
  memberRole?: "editor" | "viewer" | null;
  /** The canvas's team, when it has one. */
  team?: { status: string; hiddenAt: Date | null } | null;
  isStaff?: boolean;
  isGuildMember?: boolean;
}

const RANK = { read: 1, write: 2, owner: 3 } as const;

export function atLeast(access: CanvasAccess, needed: Exclude<CanvasAccess, null>): boolean {
  return access != null && RANK[access] >= RANK[needed];
}

function capAt(access: CanvasAccess, cap: Exclude<CanvasAccess, null>): CanvasAccess {
  return access != null && RANK[access] > RANK[cap] ? cap : access;
}

/** What the viewer's relationship to the canvas grants, before any state. */
function relationshipAccess(canvas: CanvasAccessSubject, viewer: CanvasAccessViewer): CanvasAccess {
  if (!viewer.userId) return null;
  if (canvas.teamId) {
    if (viewer.teamRole === "owner") return "owner";
    if (viewer.teamRole === "member") return "write";
    return null;
  }
  if (canvas.ownerId === viewer.userId) return "owner";
  if (viewer.memberRole === "editor") return "write";
  if (viewer.memberRole === "viewer") return "read";
  return null;
}

/**
 * - **Deleted:** only people who could delete it keep access, so they can
 *   restore it: a personal canvas's owner, or anyone who can write on a
 *   team canvas (a teammate's delete from a vault must be undoable by the
 *   team). Nobody else sees it.
 * - **Hidden** (the canvas, or its team, by staff): read-only for the
 *   personal owner, the team's owners and staff; gone for everyone else.
 * - **Archived team:** read-only.
 * - **Unlisted and public** add read for anyone.
 * - **Staff** always read, never write by virtue of being staff.
 * - **Not in the guild:** write and owner drop to read.
 */
export function canvasAccess(
  canvas: CanvasAccessSubject,
  viewer: CanvasAccessViewer,
): CanvasAccess {
  const related = relationshipAccess(canvas, viewer);
  const guildCap = (access: CanvasAccess) =>
    viewer.isGuildMember ? access : capAt(access, "read");

  if (canvas.deletedAt) {
    if (canvas.teamId) return guildCap(atLeast(related, "write") ? related : null);
    return guildCap(related === "owner" ? "owner" : null);
  }

  if (canvas.hiddenAt || viewer.team?.hiddenAt) {
    const isScopeOwner = related === "owner";
    return isScopeOwner || viewer.isStaff ? "read" : null;
  }

  let access = related;
  if (canvas.visibility === "unlisted" || canvas.visibility === "public") {
    access ??= "read";
  }
  if (viewer.isStaff) access ??= "read";

  if (viewer.team?.status === "archived") access = capAt(access, "read");

  return guildCap(access);
}

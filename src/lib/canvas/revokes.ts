import { visibilityOpenness } from "./access";

/**
 * What each change to who can reach a canvas means for its open live
 * connections. Pure and free of `@/` imports, so canvas-sync's tests can import it.
 */

export type CanvasEventScope =
  | { kind: "personal"; ownerId: string | null }
  | { kind: "team"; teamId: string };

export type CanvasMemberRole = "editor" | "viewer";

export type CanvasEvent =
  | {
      type: "hidden" | "unhidden" | "deleted" | "restored";
      canvasId: string;
      scope: CanvasEventScope;
    }
  | {
      type: "visibility_changed";
      canvasId: string;
      scope: CanvasEventScope;
      from: string;
      to: string;
    }
  | {
      type: "member_added" | "member_role_changed" | "member_removed";
      canvasId: string;
      scope: CanvasEventScope;
      userId: string;
      role?: CanvasMemberRole;
    }
  | {
      type: "moved_to_team";
      canvasId: string;
      /** The team scope the canvas now lives in. */
      scope: CanvasEventScope;
      fromOwnerId: string | null;
    };

/** Who should lose an open connection: everyone on the canvas, or one member. */
export type CanvasRevoke = { canvasId: string; userId?: string };

function narrows(from: string, to: string): boolean {
  return visibilityOpenness(to) < visibilityOpenness(from);
}

/**
 * The open connections an event should close. A whole-canvas revoke when
 * the audience shrank (hidden, deleted, moved, visibility narrowed); one
 * member's when only they lost something (removed, or downgraded to
 * viewer, so their socket reconnects read-only). Widening changes close
 * nothing.
 */
export function revokesFor(event: CanvasEvent): CanvasRevoke[] {
  switch (event.type) {
    case "hidden":
    case "deleted":
    case "moved_to_team":
      return [{ canvasId: event.canvasId }];
    case "visibility_changed":
      return narrows(event.from, event.to) ? [{ canvasId: event.canvasId }] : [];
    case "member_removed":
      return [{ canvasId: event.canvasId, userId: event.userId }];
    case "member_role_changed":
      return event.role === "viewer" ? [{ canvasId: event.canvasId, userId: event.userId }] : [];
    case "member_added":
    case "unhidden":
    case "restored":
      return [];
  }
}

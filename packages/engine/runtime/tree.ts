import { EngineError, type EngineContext, type SceneTree } from "../game/types";
import type { RuntimeEntity } from "../scene/types";
import { composePose, isWatched, relativePose, type Pose, type PoseIndex } from "./poses";

export type { SceneTree };

/** How a refusal names a scope: a sublevel by its label, else the main scene. */
export const scopeName = (scope: string | null): string =>
  scope === null ? "the main scene" : `sublevel "${scope}"`;

/** The refusal for an id no live entity has: `can't <what> "<id>"`. */
export const entityGone = (id: string, what: string): EngineError =>
  new EngineError("entity-gone", `can't ${what} "${id}": no live entity has that id`, id);

/** Kept with a linked entity for `SceneTreeDeps.follows`; the tree never reads it. */
export type FollowSlot = { held: unknown };

/** What the tree reads and calls; the lifecycle gives it these. */
export type SceneTreeDeps = {
  poses: PoseIndex;
  setPose: EngineContext["setPose"];
  /** Whether `id` is live. */
  exists(id: string): boolean;
  /** Whether `id` is live and on, its ancestors' switches included. */
  enabled(id: string): boolean;
  /** Whether a parent's movement leaves `id` where it is: something on it moves it in world space, or nothing can pose it. */
  selfMoving(id: string): boolean;
  /** Whether `id` has a body that can carry its descendants' colliders. */
  carries(id: string): boolean;
  /** Tells `id`'s systems which body above it carries its collider now; null for none. */
  ride(id: string, host: string | null): void;
  /**
   * `id`'s parent `parent` moved, which puts `id` at `pose`: "still" when
   * `id` is off or moves itself; "carried" when `parent`'s body already
   * carried its collider there and its pose alone was written; else "pose",
   * for the tree to pose it in full. `slot` stays with `id`'s link, empty
   * at first, for what `follows` looked up and may reuse next time.
   */
  follows(
    id: string,
    parent: string,
    pose: Pose,
    snap: boolean,
    slot: FollowSlot,
  ): "still" | "carried" | "pose";
  /** The sublevel `id` belongs to; null for the main scene. */
  scopeOf(id: string): string | null;
  /** `id` moved under another parent: its subtree's enabled state may have changed. */
  reparented(id: string): void;
  /** True inside a step, where a destroyed entity's events are still to be dispatched. */
  stepping(): boolean;
  tick(): number;
};

/** The runtime's scene tree: `EngineContext.tree` plus what the lifecycle tells it. */
export type RuntimeSceneTree = SceneTree & {
  /**
   * After a batch's entities exist: links each one that names a live
   * `parent`, in the order given, which is its place among its siblings;
   * records its local pose and asks it to ride.
   */
  link(entities: readonly RuntimeEntity[]): void;
  /**
   * `id` left the world: it leaves its parent's children and its own
   * children become roots. Inside a step its link is kept for `isUnder`
   * until the tick ends.
   */
  forget(id: string): void;
  /**
   * Moves a driven child to its parent's pose composed with its local one,
   * as an enable does; false when `id` isn't driven (a root, or self-moving).
   */
  drive(id: string, opts?: { snap?: boolean }): boolean;
  /** Runs `fn` with pose writes not followed and no local pose recomputed. */
  quietly<T>(fn: () => T): T;
  /** Forgets every link; at unload. */
  clear(): void;
  /**
   * Refuses `parent` for something in `scope` with `parent-scope`: when no
   * live entity has that id, or it belongs to another sublevel. `what` is
   * the refused action (`put "a"`, `spawn "marker"`), `subject` what it
   * moves, and `id` the entity it moves, when it exists yet.
   */
  checkParent(
    parent: string,
    scope: string | null,
    what: string,
    subject: string,
    id?: string,
  ): void;
};

/**
 * Parents, children and local poses. It follows the pose index: a write to
 * an entity that isn't the tree's own recomputes its local pose, then each
 * enabled, driven child is moved to its parent's pose composed with its
 * local one, in child order, and so on down.
 */
export function createSceneTree(deps: SceneTreeDeps): RuntimeSceneTree {
  /**
   * An entity with a parent or children. Child lists are replaced, never
   * mutated, so a list handed out stays as it was.
   */
  type Link = FollowSlot & {
    readonly id: string;
    parent: Link | null;
    kids: readonly Link[];
    ids: readonly string[];
    /** Its pose in its parent's frame; null without a parent. */
    local: Readonly<Pose> | null;
    /** The tree is posing it now: its writes are the tree's, not its own. */
    driving: boolean;
  };
  const links = new Map<string, Link>();
  /** The child whose pose its parent's body carried, being written now. */
  let carrying: string | null = null;
  let quiet = 0;
  /** Links of entities destroyed during tick `goneTick`, which its events still ask about. */
  const gone = new Map<string, string>();
  let goneTick = -1;

  const none: readonly string[] = [];
  const noKids: readonly Link[] = [];

  const parentOf = (id: string): string | undefined => links.get(id)?.parent?.id;
  /** Each runtime's pose index is its own shape, so the hot path reads poses through this. */
  const poseOf = deps.poses.get.bind(deps.poses);

  function linkOf(id: string): Link {
    let link = links.get(id);
    if (!link) {
      link = {
        id,
        parent: null,
        kids: noKids,
        ids: none,
        local: null,
        driving: false,
        held: undefined,
      };
      links.set(id, link);
    }
    return link;
  }

  /** Forgets `link` once it has neither a parent nor children. */
  function prune(link: Link): void {
    if (link.parent || link.kids.length > 0 || link.driving) return;
    if (links.get(link.id) === link) links.delete(link.id);
  }

  function addChild(parent: string, id: string): void {
    const p = linkOf(parent);
    const c = linkOf(id);
    c.parent = p;
    p.kids = [...p.kids, c];
    p.ids = [...p.ids, id];
  }

  function dropChild(id: string): void {
    const c = links.get(id);
    const p = c?.parent;
    if (!c || !p) return;
    c.parent = null;
    c.local = null;
    p.kids = p.kids.filter((k) => k !== c);
    p.ids = p.kids.length > 0 ? p.kids.map((k) => k.id) : none;
    if (p.kids.length === 0) p.kids = noKids;
    prune(p);
    prune(c);
  }

  /** `id`'s pose in `parent`'s frame, from the pose index; its world pose without a parent. */
  function measured(id: string, parent: string | undefined): Pose | undefined {
    const pose = deps.poses.get(id);
    if (!pose) return undefined;
    const frame = parent === undefined ? undefined : deps.poses.get(parent);
    return frame ? relativePose(pose, frame) : { x: pose.x, y: pose.y, rot: pose.rot };
  }

  function remeasure(link: Link): void {
    if (!link.parent) return;
    const local = measured(link.id, link.parent.id);
    if (local) link.local = local;
  }

  /** The nearest entity above `id` whose body carries colliders. */
  function hostOf(id: string): string | null {
    for (let at = links.get(id)?.parent; at; at = at.parent) {
      if (deps.carries(at.id)) return at.id;
    }
    return null;
  }

  /** Poses `id` as the tree, so its own watcher call is ignored, then follows it. */
  function place(id: string, pose: Pose, snap: boolean): void {
    const link = links.get(id);
    const was = link?.driving ?? false;
    if (link) link.driving = true;
    try {
      deps.setPose(id, pose.x, pose.y, pose.rot, snap ? { snap } : undefined);
    } finally {
      if (link) {
        link.driving = was;
        prune(link);
      }
    }
    const now = links.get(id);
    if (now) follow(now, snap);
  }

  /** Moves each enabled, driven child of `link` to where its pose puts it, depth first. */
  function follow(link: Link, snap: boolean): void {
    const list = link.kids;
    if (list.length === 0) return;
    const frame = poseOf(link.id);
    if (!frame) return;
    for (const child of list) {
      const local = child.local;
      if (!local) continue;
      const pose = composePose(frame.x, frame.y, frame.rot, local);
      const outer = carrying;
      carrying = child.id;
      let how: "still" | "carried" | "pose";
      try {
        how = deps.follows(child.id, link.id, pose, snap, child);
      } finally {
        carrying = outer;
      }
      if (how === "carried") follow(child, snap);
      else if (how === "pose") place(child.id, pose, snap);
    }
  }

  function wrote(id: string, snap: boolean): void {
    if (quiet > 0 || id === carrying) return;
    const link = links.get(id);
    if (!link || link.driving) return;
    remeasure(link);
    follow(link, snap);
  }

  if (isWatched(deps.poses)) deps.poses.watch(wrote);

  function subtree(id: string): string[] {
    const out: string[] = [id];
    const visit = (link: Link) => {
      for (const child of link.kids) {
        out.push(child.id);
        visit(child);
      }
    };
    const link = links.get(id);
    if (link) visit(link);
    return out;
  }

  function isUnder(id: string, ancestor: string): boolean {
    const late = gone.size > 0 && goneTick === deps.tick();
    for (let at: string | undefined = id; at !== undefined; ) {
      if (at === ancestor) return true;
      at = parentOf(at) ?? (late ? gone.get(at) : undefined);
    }
    return false;
  }

  function live(id: string, what: string): void {
    if (!deps.exists(id)) throw entityGone(id, what);
  }

  function checkParent(
    parent: string,
    scope: string | null,
    what: string,
    subject: string,
    id?: string,
  ): void {
    if (!deps.exists(parent)) {
      throw new EngineError(
        "parent-scope",
        `can't ${what} under "${parent}": no live entity has that id`,
        parent,
      );
    }
    const theirs = deps.scopeOf(parent);
    if (theirs !== scope) {
      throw new EngineError(
        "parent-scope",
        `can't ${what} under "${parent}": ${subject} belongs to ${scopeName(scope)} and "${parent}" to ${scopeName(theirs)}`,
        id ?? parent,
      );
    }
  }

  const tree: RuntimeSceneTree = {
    parent: (id) => parentOf(id) ?? null,
    children: (id) => links.get(id)?.ids ?? none,
    subtree,
    root(id) {
      let at = links.get(id);
      while (at?.parent) at = at.parent;
      return at?.id ?? id;
    },
    isUnder,
    local(id) {
      const link = links.get(id);
      if (!link?.parent) return deps.poses.get(id);
      return deps.selfMoving(id) ? measured(id, link.parent.id) : (link.local ?? undefined);
    },
    setLocal(id, x, y, rot) {
      const link = links.get(id);
      if (!link?.parent) {
        deps.setPose(id, x, y, rot);
        return;
      }
      live(id, "pose");
      const local = { x, y, rot: rot ?? link.local?.rot ?? 0 };
      link.local = local;
      const frame = deps.poses.get(link.parent.id);
      if (frame) place(id, composePose(frame.x, frame.y, frame.rot, local), false);
    },
    setParent(id, parent, opts) {
      live(id, "reparent");
      if (parent !== null) {
        if (deps.exists(parent) && isUnder(parent, id)) {
          throw new EngineError(
            "parent-cycle",
            `can't put "${id}" under "${parent}": ${parent === id ? "an entity can't be its own parent" : `"${parent}" is below "${id}"`}`,
            id,
          );
        }
        checkParent(parent, deps.scopeOf(id), `put "${id}"`, `"${id}"`, id);
      }
      const was = parentOf(id);
      if ((was ?? null) === parent) return;
      const keepWorld = opts?.keepWorld ?? true;
      const kept = links.get(id)?.local ?? measured(id, was);
      dropChild(id);
      if (parent !== null) addChild(parent, id);
      const link = links.get(id);
      if (keepWorld || !kept) {
        if (link) remeasure(link);
      } else if (parent !== null && link) {
        link.local = kept;
        const frame = deps.poses.get(parent);
        if (frame) place(id, composePose(frame.x, frame.y, frame.rot, kept), false);
      } else {
        place(id, kept, false);
      }
      for (const at of subtree(id)) deps.ride(at, hostOf(at));
      deps.reparented(id);
    },
    link(entities) {
      const linked: Link[] = [];
      // A parent in the batch is linked under the id string its own record
      // holds, the one its pose writes pass, so they find it by identity.
      let own: Map<string, string> | undefined;
      for (const e of entities) {
        if (e.parent === undefined || e.parent === e.id || !deps.exists(e.parent)) continue;
        own ??= new Map(entities.map((x) => [x.id, x.id]));
        dropChild(e.id);
        addChild(own.get(e.parent) ?? e.parent, e.id);
        linked.push(linkOf(e.id));
      }
      for (const link of linked) remeasure(link);
      for (const link of linked) deps.ride(link.id, hostOf(link.id));
    },
    forget(id) {
      const link = links.get(id);
      if (!link) return;
      const parent = link.parent?.id;
      if (deps.stepping()) {
        const tick = deps.tick();
        if (goneTick !== tick) {
          gone.clear();
          goneTick = tick;
        }
        if (parent !== undefined) gone.set(id, parent);
      }
      dropChild(id);
      for (const child of link.kids) {
        child.parent = null;
        child.local = null;
        prune(child);
      }
      link.kids = noKids;
      link.ids = none;
      links.delete(id);
    },
    drive(id, opts) {
      const link = links.get(id);
      const local = link?.local;
      const frame = link?.parent ? deps.poses.get(link.parent.id) : undefined;
      if (!frame || !local || deps.selfMoving(id)) return false;
      place(id, composePose(frame.x, frame.y, frame.rot, local), opts?.snap === true);
      return true;
    },
    quietly(fn) {
      quiet++;
      try {
        return fn();
      } finally {
        quiet--;
      }
    },
    clear() {
      links.clear();
      carrying = null;
      gone.clear();
      goneTick = -1;
    },
    checkParent,
  };
  return tree;
}

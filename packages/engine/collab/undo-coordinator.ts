import * as Y from "yjs";

import { DOC_MAPS, LOG_ARRAY, type DocOrigin } from "./types";
import type { SelectionMeta } from "./undo";

/** A step's selection and the doc it belongs to, restored when the step is undone or redone. */
export type StepSelection = SelectionMeta & { doc: string };

export type UndoneStep = {
  label: string;
  /** The docs the step changed, in write order. */
  docs: string[];
  selection?: StepSelection;
  /** Why nothing was undone or redone: the step's changes are gone for good (it leaves the stack). */
  refused?: string;
};

export type UndoCoordinator = {
  /** Registers a doc this client writes to; its Y.UndoManager tracks this client's origin only. */
  attach(docName: string, doc: Y.Doc): void;
  /** Drops the doc's manager and its part of every step; a step left with no docs goes. */
  detach(docName: string): void;
  /**
   * Ends one step; `docs` are the docs the step wrote, in write order,
   * `label` names it. An attached doc written since the last commit but not
   * named joins the step after the named ones; a commit that wrote nothing
   * adds no step.
   */
  commit(step: { docs: string[]; label: string; selection?: StepSelection }): void;
  /**
   * Marks every step on either stack that wrote `docName`: one that later
   * finds nothing left to change is answered as refused with `reason`
   * instead of being skipped for the step below it.
   */
  refuseStale(docName: string, reason: string): void;
  /** Undoes this client's last step in every doc it wrote, newest doc first. */
  undo(): UndoneStep | null;
  redo(): UndoneStep | null;
  /** The step `undo` would take now, without taking it: writes since the last commit first, as one "Edit" step. */
  peekUndo(): UndoneStep | null;
  /** The step `redo` would take now; null when writes since the last commit would clear the redo stack. */
  peekRedo(): UndoneStep | null;
  canUndo(): boolean;
  canRedo(): boolean;
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
  /** Docs with steps on either stack: the session keeps them connected. */
  pinned(): readonly string[];
  destroy(): void;
};

export const UNDO_CAP = 100;

/** Root types no manager tracks: the history rows and the seeder's header. */
const isUntrackedRoot = (name: string) => name === LOG_ARRAY || name === DOC_MAPS.meta;

type RootType = Y.Doc["share"] extends Map<string, infer T> ? T : never;

/** How many of a doc manager's stack items one step owns. */
type Part = { doc: string; items: number };
type Step = { label: string; parts: Part[]; selection?: StepSelection; refused?: string };

type Attached = {
  doc: Y.Doc;
  manager: Y.UndoManager;
  /** The manager's undo stack length after the last commit, undo or redo. */
  base: number;
  release: () => void;
};

/**
 * Moves the top `n` items of one stack of `manager` to the other, as `n`
 * steps of its own undo or redo, and returns how many landed there (an item
 * a collaborator has since overwritten changes nothing and moves nowhere).
 * The older items are set aside meanwhile, so Yjs's skipping of no-op items
 * never reaches into another step's.
 */
function replay(manager: Y.UndoManager, from: "undo" | "redo", n: number): number {
  const source = () => (from === "undo" ? manager.undoStack : manager.redoStack);
  const target = () => (from === "undo" ? manager.redoStack : manager.undoStack);
  const stack = source();
  const take = Math.min(n, stack.length);
  if (take === 0) return 0;
  const older = stack.splice(0, stack.length - take);
  const before = target().length;
  while (stack.length > 0 && source() === stack) {
    if (!(from === "undo" ? manager.undo() : manager.redo())) break;
  }
  source().unshift(...older);
  return Math.max(0, target().length - before);
}

/** Drops the oldest `n` undo items, releasing what Yjs kept for them. */
function dropOldest(manager: Y.UndoManager, n: number): void {
  const take = Math.min(n, manager.undoStack.length);
  if (take === 0) return;
  const keep = manager.undoStack.slice(take);
  manager.undoStack = manager.undoStack.slice(0, take);
  manager.clear(true, false);
  manager.undoStack = keep;
}

const PENDING_LABEL = "Edit";

/**
 * One undo stack for this client across every doc it writes in a project.
 * Each attached doc gets a `Y.UndoManager` with `createSceneUndo`'s settings
 * (`captureTimeout` 0, `stopCapturing()` per step, only `origin` tracked, by
 * identity) over every root type but `log` and `meta`, so undo never
 * removes a history row. The coordinator's stack holds which items of which
 * managers make each step, so a step that wrote several docs undoes and
 * redoes as one. The stack keeps the newest `cap` steps.
 */
export function createUndoCoordinator(
  origin: DocOrigin,
  opts: { cap?: number } = {},
): UndoCoordinator {
  const cap = Math.max(1, opts.cap ?? UNDO_CAP);
  const attached = new Map<string, Attached>();
  let undoStack: Step[] = [];
  let redoStack: Step[] = [];

  const rebase = () => {
    for (const a of attached.values()) a.base = a.manager.undoStack.length;
  };

  const out = (step: Step): UndoneStep => ({
    label: step.label,
    docs: step.parts.map((p) => p.doc),
    ...(step.selection ? { selection: step.selection } : {}),
  });

  function commit(step: { docs: string[]; label: string; selection?: StepSelection }): void {
    const order = [...new Set(step.docs)].filter((d) => attached.has(d));
    for (const name of attached.keys()) if (!order.includes(name)) order.push(name);
    const parts: Part[] = [];
    for (const name of order) {
      const a = attached.get(name)!;
      a.manager.stopCapturing();
      const items = a.manager.undoStack.length - a.base;
      if (items > 0) parts.push({ doc: name, items });
    }
    if (parts.length === 0) return;
    undoStack.push({
      label: step.label,
      parts,
      ...(step.selection ? { selection: step.selection } : {}),
    });
    if (redoStack.length > 0) {
      redoStack = [];
      for (const a of attached.values()) a.manager.clear(false, true);
    }
    while (undoStack.length > cap) {
      for (const part of undoStack.shift()!.parts) {
        const a = attached.get(part.doc);
        if (a) dropOldest(a.manager, part.items);
      }
    }
    rebase();
  }

  /** Writes made since the last commit become a step of their own, so they're undone first. */
  const flush = () => commit({ docs: [], label: PENDING_LABEL });

  function move(from: "undo" | "redo"): UndoneStep | null {
    flush();
    const source = from === "undo" ? undoStack : redoStack;
    const target = from === "undo" ? redoStack : undoStack;
    while (source.length > 0) {
      const step = source.pop()!;
      const ordered = from === "undo" ? [...step.parts].reverse() : step.parts;
      const moved: Part[] = [];
      for (const part of ordered) {
        const a = attached.get(part.doc);
        const items = a ? replay(a.manager, from, part.items) : 0;
        if (items > 0) moved.push({ doc: part.doc, items });
      }
      rebase();
      if (moved.length === 0) {
        if (step.refused === undefined) continue;
        return { label: step.label, docs: [], refused: step.refused };
      }
      if (from === "undo") moved.reverse();
      const next: Step = { ...step, parts: moved };
      target.push(next);
      return out(next);
    }
    return null;
  }

  /** The docs written since the last commit, in the order a flush would name them. */
  const pendingDocs = () =>
    [...attached].filter(([, a]) => a.manager.undoStack.length > a.base).map(([name]) => name);

  function peek(from: "undo" | "redo"): UndoneStep | null {
    const pending = pendingDocs();
    if (pending.length > 0) return from === "undo" ? { label: PENDING_LABEL, docs: pending } : null;
    const source = from === "undo" ? undoStack : redoStack;
    const top = source[source.length - 1];
    return top ? out(top) : null;
  }

  function detach(docName: string): void {
    const a = attached.get(docName);
    if (!a) return;
    attached.delete(docName);
    a.release();
    const prune = (stack: Step[]) =>
      stack
        .map((s) => ({ ...s, parts: s.parts.filter((p) => p.doc !== docName) }))
        .filter((s) => s.parts.length > 0);
    undoStack = prune(undoStack);
    redoStack = prune(redoStack);
  }

  return {
    attach(docName, doc) {
      const current = attached.get(docName);
      if (current?.doc === doc) return;
      if (current) throw new Error(`Undo: "${docName}" is already attached to another doc.`);
      for (const [name, a] of attached)
        if (a.doc === doc) throw new Error(`Undo: this doc is already attached as "${name}".`);

      const tracked = new Set<RootType>();
      const roots = () => {
        const fresh: RootType[] = [];
        for (const [name, type] of doc.share) {
          if (isUntrackedRoot(name) || tracked.has(type)) continue;
          tracked.add(type);
          fresh.push(type);
        }
        return fresh;
      };
      const manager = new Y.UndoManager(roots(), {
        doc,
        trackedOrigins: new Set([origin]),
        captureTimeout: 0,
      });
      // A root type first written inside a transaction joins the scope before the manager looks at it.
      const widen = () => {
        const fresh = roots();
        if (fresh.length > 0) manager.addToScope(fresh);
      };
      const onDestroy = () => detach(docName);
      doc.on("beforeObserverCalls", widen);
      doc.on("destroy", onDestroy);
      attached.set(docName, {
        doc,
        manager,
        base: manager.undoStack.length,
        release() {
          doc.off("beforeObserverCalls", widen);
          doc.off("destroy", onDestroy);
          manager.destroy();
        },
      });
    },
    detach,
    commit,
    refuseStale(docName, reason) {
      for (const s of [...undoStack, ...redoStack])
        if (s.parts.some((p) => p.doc === docName)) s.refused = reason;
    },
    undo: () => move("undo"),
    redo: () => move("redo"),
    peekUndo: () => peek("undo"),
    peekRedo: () => peek("redo"),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => undoStack[undoStack.length - 1]?.label,
    redoLabel: () => redoStack[redoStack.length - 1]?.label,
    pinned() {
      const named = new Set<string>();
      for (const s of [...undoStack, ...redoStack]) for (const p of s.parts) named.add(p.doc);
      return [...attached.keys()].filter((n) => named.has(n));
    },
    destroy() {
      for (const name of [...attached.keys()]) detach(name);
      undoStack = [];
      redoStack = [];
    },
  };
}

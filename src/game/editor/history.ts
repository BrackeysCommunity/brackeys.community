import type { OpBatch, Ref } from "../scene/types";

export type HistoryEntry = {
  label: string;
  batch: OpBatch;
  inverse: OpBatch;
  touched: Ref[];
  selectionBefore: Ref[];
  selectionAfter: Ref[];
  /** "human", "agent", or a named agent. */
  actor: string;
  at: number;
};

export type HistoryOptions = {
  cap?: number;
  coalesceMs?: number;
  now?: () => number;
};

export type History = {
  push(entry: Omit<HistoryEntry, "at"> & { at?: number }): void;
  /** Steps back and returns the entry to revert, or null at the start. */
  undo(): HistoryEntry | null;
  /** Steps forward and returns the entry to re-apply, or null at the end. */
  redo(): HistoryEntry | null;
  peekUndo(): HistoryEntry | null;
  peekRedo(): HistoryEntry | null;
  canUndo(): boolean;
  canRedo(): boolean;
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
  markSaved(): void;
  isDirty(): boolean;
  entries(): readonly HistoryEntry[];
  clear(): void;
};

/** The ref a single-op move or update batch acts on, for coalescing. */
function coalesceKey(batch: OpBatch): string | null {
  if (batch.ops.length !== 1) return null;
  const op = batch.ops[0]!;
  if (op.op === "update") return `update:${op.ref}`;
  if (op.op === "move") return `move:${[...op.refs].sort().join(",")}`;
  return null;
}

export function createHistory({
  cap = 500,
  coalesceMs = 500,
  now = () => Date.now(),
}: HistoryOptions = {}): History {
  let list: HistoryEntry[] = [];
  let head = 0;
  /** The head index when last saved; null once that point is gone. */
  let saved: number | null = 0;

  const coalesce = (prev: HistoryEntry, next: HistoryEntry): HistoryEntry => ({
    ...prev,
    batch: { ...prev.batch, ops: [...prev.batch.ops, ...next.batch.ops] },
    inverse: { ...next.inverse, ops: [...next.inverse.ops, ...prev.inverse.ops] },
    touched: [...new Set([...prev.touched, ...next.touched])],
    selectionAfter: next.selectionAfter,
    at: next.at,
  });

  return {
    push(input) {
      const entry: HistoryEntry = { ...input, at: input.at ?? now() };
      if (saved !== null && saved > head) saved = null;
      list = list.slice(0, head);
      const prev = list[head - 1];
      const key = coalesceKey(entry.batch);
      if (
        prev &&
        key !== null &&
        saved !== head &&
        prev.actor === entry.actor &&
        coalesceKey(prev.batch) === key &&
        entry.at - prev.at <= coalesceMs
      ) {
        list[head - 1] = coalesce(prev, entry);
        return;
      }
      list.push(entry);
      head++;
      while (list.length > cap) {
        list.shift();
        head--;
        if (saved !== null) saved = saved > 0 ? saved - 1 : null;
      }
    },
    undo() {
      if (head === 0) return null;
      head--;
      return list[head]!;
    },
    redo() {
      if (head >= list.length) return null;
      return list[head++]!;
    },
    peekUndo: () => list[head - 1] ?? null,
    peekRedo: () => list[head] ?? null,
    canUndo: () => head > 0,
    canRedo: () => head < list.length,
    undoLabel: () => list[head - 1]?.label,
    redoLabel: () => list[head]?.label,
    markSaved() {
      saved = head;
    },
    isDirty: () => saved !== head,
    entries: () => list,
    clear() {
      list = [];
      head = 0;
      saved = 0;
    },
  };
}

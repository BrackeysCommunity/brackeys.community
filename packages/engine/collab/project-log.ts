import type * as Y from "yjs";

import { randomKey } from "./keys";
import { LOG_CAP } from "./log";
import { LOG_ARRAY, type LogEntry, type ProjectLogEntry } from "./types";

export type ProjectLogInput = Omit<ProjectLogEntry, "id" | "at"> & {
  /** Chosen beforehand when the docs the batch writes later must name it. */
  id?: string;
  at?: number;
};

/** The project doc's `log`: one entry per batch that wrote two or more docs. */
export const projectLogArray = (doc: Y.Doc) => doc.getArray<ProjectLogEntry>(LOG_ARRAY);

/**
 * Appends an entry to the project doc's log and trims it to `LOG_CAP`, as
 * `appendLog` does for a doc's own. Call inside the batch's transaction on
 * the project doc, so the write carries the batch's origin.
 */
export function appendProjectLog(doc: Y.Doc, input: ProjectLogInput): ProjectLogEntry {
  const log = projectLogArray(doc);
  const { id, at, ...rest } = input;
  const entry: ProjectLogEntry = { id: id ?? randomKey(), at: at ?? Date.now(), ...rest };
  doc.transact(() => {
    log.push([entry]);
    if (log.length > LOG_CAP) log.delete(0, log.length - LOG_CAP);
  });
  return entry;
}

/** The project's cross-doc history, oldest first. */
export function readProjectLog(doc: Y.Doc): ProjectLogEntry[] {
  return projectLogArray(doc).toArray();
}

/** The entries whose batch wrote `docName`: what a doc's history panel merges with the doc's own log. */
export function projectLogFor(
  entries: readonly ProjectLogEntry[],
  docName: string,
): ProjectLogEntry[] {
  return entries.filter((e) => e.docs.some((d) => d.doc === docName));
}

/** Calls back with the whole project log whenever it changes. Returns the unsubscribe. */
export function observeProjectLog(
  doc: Y.Doc,
  cb: (entries: ProjectLogEntry[]) => void,
): () => void {
  const log = projectLogArray(doc);
  const handler = () => cb(log.toArray());
  log.observe(handler);
  return () => log.unobserve(handler);
}

/** A history row: one of the doc's own entries, marked when it was part of a batch that wrote other docs too. */
export type HistoryRow = LogEntry & {
  /** The project entry this row belongs to: its id and every doc the batch wrote. */
  project?: { entry: string; docs: string[] };
};

/**
 * A doc's history panel: its own `log` plus the project log's entries that
 * name it, merged by `at` (ties keep the doc's order). A project entry shows
 * once, on the doc's own entry for that batch, carrying the docs it touched;
 * one whose doc entry has aged out of the doc's log shows as a row of its
 * own, under the project entry's id.
 */
export function historyRows(
  log: readonly LogEntry[],
  projectLog: readonly ProjectLogEntry[],
  docName: string,
): HistoryRow[] {
  const byDocEntry = new Map<string, ProjectLogEntry>();
  for (const p of projectLogFor(projectLog, docName))
    for (const d of p.docs) if (d.doc === docName) byDocEntry.set(d.entry, p);
  const projectOf = (p: ProjectLogEntry) => ({ entry: p.id, docs: p.docs.map((d) => d.doc) });
  const shown = new Set<string>();
  const rows: HistoryRow[] = log.map((entry) => {
    const p = byDocEntry.get(entry.id);
    if (!p) return entry;
    shown.add(p.id);
    return { ...entry, project: projectOf(p) };
  });
  for (const p of new Set(byDocEntry.values())) {
    if (shown.has(p.id)) continue;
    const at = rows.findIndex((r) => r.at > p.at);
    const row: HistoryRow = {
      id: p.id,
      actor: p.actor,
      label: p.label,
      at: p.at,
      keys: [],
      project: projectOf(p),
    };
    rows.splice(at < 0 ? rows.length : at, 0, row);
  }
  return rows;
}

import type * as Y from "yjs";

import { sameValue, stableJson } from "../project/canonical";
import { hashText } from "../scene/hash";
import { randomKey } from "./keys";
import { LOG_ARRAY, Z_FIELD, type LogEntry } from "./types";

export { sameValue, stableJson };

/** How many entries the doc keeps; the oldest go first. */
export const LOG_CAP = 200;
/** An entry whose `before` would be larger than this (JSON characters) is kept without it, and can't be reverted. */
export const LOG_ENTRY_MAX_CHARS = 64 * 1024;

export type LogInput = Omit<LogEntry, "id" | "at"> & { at?: number };

export const logArray = (doc: Y.Doc) => doc.getArray<LogEntry>(LOG_ARRAY);

/** A short digest of an entry's state, ignoring its place in the order. */
export function fingerprint(rec: unknown): string {
  if (rec !== null && typeof rec === "object" && !Array.isArray(rec) && Z_FIELD in rec) {
    const { [Z_FIELD]: _z, ...rest } = rec as Record<string, unknown>;
    return hashText(stableJson(rest));
  }
  return hashText(stableJson(rec));
}

/** Appends an entry and trims to `LOG_CAP`. Call inside the batch's transaction. */
export function appendLog(doc: Y.Doc, input: LogInput): LogEntry {
  const log = logArray(doc);
  const entry: LogEntry = {
    id: randomKey(),
    at: Date.now(),
    ...input,
  };
  if (entry.before && JSON.stringify(entry.before).length > LOG_ENTRY_MAX_CHARS) {
    delete entry.before;
    delete entry.after;
  }
  log.push([entry]);
  if (log.length > LOG_CAP) log.delete(0, log.length - LOG_CAP);
  return entry;
}

/** The doc's history, oldest first. */
export function readLog(doc: Y.Doc): LogEntry[] {
  return logArray(doc).toArray();
}

/** Calls back with the whole log whenever it changes. */
export function observeLog(doc: Y.Doc, cb: (entries: LogEntry[]) => void): () => void {
  const log = logArray(doc);
  const handler = () => cb(log.toArray());
  log.observe(handler);
  return () => log.unobserve(handler);
}

import * as Y from "yjs";

import type { DocLayout } from "../project/kinds";
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import {
  entitiesMap,
  instancesMap,
  paramsMap,
  patchMap,
  patchRecord,
  prefabHeaderMap,
  prefabOverridesMap,
  prefabsMap,
  readAssets,
  readDoc,
  recordMap,
  recordOf,
  sceneMap,
  settingsMap,
  writeAssets,
} from "./convert";
import { layoutFromDoc, layoutPatch } from "./layout";
import { appendLog, fingerprint, readLog, sameValue } from "./log";
import { PREFAB_HEADER_KEY } from "./prefab-doc";
import { appendProjectLog, readProjectLog } from "./project-log";
import type { ProjectSession } from "./project-session";
import {
  ASSETS_KEY,
  GROUP_KEY_PREFIX,
  INSTANCE_KEY_PREFIX,
  PARAM_KEY_PREFIX,
  PREFAB_KEY_PREFIX,
  SCENE_KEY,
  SETTINGS_KEY,
  VARIANT_KEY,
  type DocOrigin,
  type EntityRecord,
  type LogEntry,
  type ProjectLogEntry,
  type SceneOrigin,
} from "./types";

/** Log keys of a declarative doc's top-level content fields: `@content:<field>`. */
export const CONTENT_KEY_PREFIX = "@content:";

export const contentLogKey = (field: string) => `${CONTENT_KEY_PREFIX}${field}`;

export type RevertResult = { ok: true; keys: string[] } | { ok: false; issue: SceneIssue };

export type RevertOptions = {
  /** A declarative kind's layout, for the `@content:` keys of an asset doc's entries. */
  layout?: DocLayout;
};

/** Which map a log key names, and the key inside it. */
function slotOf(
  doc: Y.Doc,
  key: string,
): { map: Y.Map<unknown>; key: string; kind: "record" | "value" } {
  if (key.startsWith(INSTANCE_KEY_PREFIX))
    return {
      map: instancesMap(doc) as Y.Map<unknown>,
      key: key.slice(INSTANCE_KEY_PREFIX.length),
      kind: "record",
    };
  if (key.startsWith(PREFAB_KEY_PREFIX))
    return { map: prefabsMap(doc), key: key.slice(PREFAB_KEY_PREFIX.length), kind: "value" };
  if (key.startsWith(PARAM_KEY_PREFIX))
    return { map: paramsMap(doc), key: key.slice(PARAM_KEY_PREFIX.length), kind: "value" };
  return { map: entitiesMap(doc) as Y.Map<unknown>, key, kind: "record" };
}

/** A prefab doc's header as its log records it: `id` and `contract`. */
function prefabHeaderOf(doc: Y.Doc): Record<string, unknown> {
  const { id, contract } = readDoc(doc).prefab ?? { id: "" };
  return { id, ...(contract !== undefined ? { contract } : {}) };
}

/** A prefab doc's variant as its log records it: `base` and `overrides`, each absent when unset. */
function variantOf(doc: Y.Doc): Record<string, unknown> {
  const { base, overrides } = readDoc(doc).prefab ?? { id: "" };
  return {
    ...(base !== undefined ? { base } : {}),
    ...(overrides !== undefined ? { overrides } : {}),
  };
}

/** The state a log key is in now: a record, the settings, the header, a content field, or null when gone. */
function currentOf(doc: Y.Doc, key: string, opts: RevertOptions): unknown {
  if (key === SETTINGS_KEY) return settingsMap(doc).toJSON();
  if (key === SCENE_KEY) return sceneMap(doc).toJSON();
  if (key === ASSETS_KEY) {
    const ids = readAssets(doc);
    return ids.length > 0 ? ids : null;
  }
  if (key === VARIANT_KEY) return variantOf(doc);
  if (key === PREFAB_HEADER_KEY) return prefabHeaderOf(doc);
  if (key.startsWith(CONTENT_KEY_PREFIX)) {
    if (!opts.layout) return null;
    return layoutFromDoc(doc, opts.layout)[key.slice(CONTENT_KEY_PREFIX.length)] ?? null;
  }
  const slot = slotOf(doc, key);
  const value = slot.map.get(slot.key);
  if (value === undefined) return null;
  if (slot.kind === "record") return value instanceof Y.Map ? recordOf(value) : null;
  return value instanceof Y.Map ? value.toJSON() : structuredClone(value);
}

function writeMap(map: Y.Map<unknown>, before: Record<string, unknown>): void {
  for (const k of [...map.keys()]) if (!(k in before)) map.delete(k);
  for (const [k, v] of Object.entries(before))
    if (!sameValue(map.get(k), v)) map.set(k, structuredClone(v));
}

type VariantBefore = { base?: string; overrides?: Record<string, unknown> };
type HeaderBefore = { id: string; contract?: unknown };

function writeVariant(doc: Y.Doc, prev: VariantBefore): void {
  const header = prefabHeaderMap(doc);
  if (prev.base === undefined) header.delete("base");
  else if (header.get("base") !== prev.base) header.set("base", prev.base);
  patchMap(prefabOverridesMap(doc), prev.overrides ?? {});
}

function writeHeader(doc: Y.Doc, prev: HeaderBefore): void {
  const header = prefabHeaderMap(doc);
  if (header.get("id") !== prev.id) header.set("id", prev.id);
  if (prev.contract === undefined) header.delete("contract");
  else if (!sameValue(header.get("contract"), prev.contract))
    header.set("contract", structuredClone(prev.contract));
}

/** Why `entry` can't be reverted in `doc` now, or null when it can. */
export function revertProblem(
  doc: Y.Doc,
  entry: LogEntry,
  opts: RevertOptions = {},
): SceneIssue | null {
  const { before, after } = entry;
  if (!before || !after)
    return makeIssue("op-invalid", {
      message: `"${entry.label}" was too large to keep its inverse, so it can't be reverted.`,
    });
  if (entry.keys.some((k) => k.startsWith(GROUP_KEY_PREFIX)))
    return makeIssue("op-invalid", {
      message: `"${entry.label}" changed a group, which format 5 turned into a node, so it can't be reverted.`,
    });
  if (!opts.layout && entry.keys.some((k) => k.startsWith(CONTENT_KEY_PREFIX)))
    return makeIssue("op-invalid", {
      message: `"${entry.label}" changed an asset's content; reverting it needs the asset kind's layout.`,
    });
  const changed = entry.keys.filter((key) => {
    const now = currentOf(doc, key, opts);
    const expected = after[key] ?? null;
    return now === null ? expected !== null : expected === null || fingerprint(now) !== expected;
  });
  if (changed.length === 0) return null;
  return makeIssue("op-invalid", {
    message: `"${entry.label}" can't be reverted: ${changed.length} of the entries it changed ${changed.length === 1 ? "has" : "have"} changed since.`,
    hint: "Undo or edit those entries by hand, or revert the later entries first.",
  });
}

/** Writes `entry`'s inverse and its own log entry, in one transaction from `origin`; the caller has checked it. */
function writeRevert(
  doc: Y.Doc,
  entry: LogEntry,
  origin: DocOrigin,
  opts: RevertOptions,
  label: string,
): LogEntry {
  const before = entry.before!;
  const undone = Object.fromEntries(entry.keys.map((k) => [k, currentOf(doc, k, opts)]));
  let logged: LogEntry | undefined;
  doc.transact(() => {
    const content = entry.keys.filter((k) => k.startsWith(CONTENT_KEY_PREFIX));
    if (content.length > 0 && opts.layout) {
      const next = layoutFromDoc(doc, opts.layout);
      for (const key of content) {
        const field = key.slice(CONTENT_KEY_PREFIX.length);
        const prev = before[key] ?? null;
        if (prev === null) delete next[field];
        else next[field] = structuredClone(prev);
      }
      layoutPatch(doc, opts.layout, next, origin);
    }
    for (const key of entry.keys) {
      if (key.startsWith(CONTENT_KEY_PREFIX)) continue;
      const prev = before[key] ?? null;
      if (key === SETTINGS_KEY) writeMap(settingsMap(doc), (prev ?? {}) as Record<string, unknown>);
      else if (key === SCENE_KEY) writeMap(sceneMap(doc), (prev ?? {}) as Record<string, unknown>);
      else if (key === ASSETS_KEY) writeAssets(doc, (prev ?? []) as string[]);
      else if (key === VARIANT_KEY) writeVariant(doc, (prev ?? {}) as VariantBefore);
      else if (key === PREFAB_HEADER_KEY) writeHeader(doc, (prev ?? { id: "" }) as HeaderBefore);
      else {
        const slot = slotOf(doc, key);
        const current = slot.map.get(slot.key);
        if (prev === null) slot.map.delete(slot.key);
        else if (slot.kind === "value") slot.map.set(slot.key, structuredClone(prev));
        else if (current instanceof Y.Map)
          patchRecord(current, recordOf(current), prev as EntityRecord);
        else slot.map.set(slot.key, recordMap(prev as EntityRecord));
      }
    }
    logged = appendLog(doc, {
      actor: origin,
      label,
      keys: entry.keys,
      kind: "revert",
      before: undone,
      after: Object.fromEntries(
        entry.keys.map((k) => [k, before[k] === null ? null : fingerprint(before[k])]),
      ),
    });
  }, origin);
  return logged!;
}

/**
 * Applies a history entry's inverse as a new batch from `origin`: every key
 * it touched goes back to its state before the entry. Refused with an
 * issue, writing nothing, when any of those keys has changed since, or when
 * the entry was too large to keep its inverse. An asset doc's entry needs
 * its kind's `layout`.
 */
export function revertEntry(
  doc: Y.Doc,
  entry: LogEntry,
  origin: SceneOrigin,
  opts: RevertOptions = {},
): RevertResult {
  const problem = revertProblem(doc, entry, opts);
  if (problem) return { ok: false, issue: problem };
  writeRevert(doc, entry, origin, opts, `Revert ${entry.label}`);
  return { ok: true, keys: entry.keys };
}

export type ProjectRevertResult =
  | {
      ok: true;
      /** The docs written, in write order. */
      docs: string[];
      keys: string[];
      /** The new project entry, when the revert wrote two or more docs. */
      entry?: ProjectLogEntry;
    }
  | { ok: false; issue: SceneIssue };

const notFound = (id: string): { ok: false; issue: SceneIssue } => ({
  ok: false,
  issue: makeIssue("ref-not-found", {
    message: `No project history entry ${id}; it may have aged out of the log.`,
  }),
});

/**
 * Reverts a project entry: each doc's own entry for that batch, checked
 * first in every doc and then written as one new cross-doc batch (one
 * transaction and log entry per doc, one project entry, one undo step when
 * `origin` is the session's). Refused, writing nothing, when any doc has
 * changed since (the issue names the doc), when a doc's entry has aged out,
 * or when the batch changed the registry, which keeps no inverse: undo
 * that instead. The docs it names must be open, or `revertProjectEntry`
 * opens them first.
 */
export function revertOpenProjectEntry(
  session: ProjectSession,
  entryId: string,
  origin: DocOrigin = session.origin,
): ProjectRevertResult {
  const entry = readProjectLog(session.projectDoc).find((e) => e.id === entryId);
  if (!entry) return notFound(entryId);
  type Part = { name: string; doc: Y.Doc; log: LogEntry; opts: RevertOptions };
  const parts: Part[] = [];
  for (const { doc: name, entry: logId } of entry.docs) {
    const fail = (message: string) => ({
      ok: false as const,
      issue: makeIssue("op-invalid", { message, entityIds: [name] }),
    });
    if (name === session.name)
      return fail(
        `"${entry.label}" changed the project's assets, which history doesn't keep the inverse of; undo it instead.`,
      );
    const open = session.get(name);
    if (!open) return fail(`"${entry.label}" changed ${name}, which isn't open.`);
    if (open.readOnly && open.issue) return { ok: false, issue: open.issue };
    const log = readLog(open.doc).find((e) => e.id === logId);
    if (!log)
      return fail(
        `"${entry.label}"'s change to ${name} has aged out of its history, so it can't be reverted.`,
      );
    const opts: RevertOptions = open.layout ? { layout: open.layout } : {};
    const problem = revertProblem(open.doc, log, opts);
    if (problem)
      return {
        ok: false,
        issue: {
          ...problem,
          message: `${name} has changed: ${problem.message}`,
          entityIds: [name],
        },
      };
    parts.push({ name, doc: open.doc, log, opts });
  }
  const label = `Revert ${entry.label}`;
  const written = parts.map((p) => ({
    doc: p.name,
    entry: writeRevert(p.doc, p.log, origin, p.opts, label).id,
  }));
  let logged: ProjectLogEntry | undefined;
  if (written.length > 1)
    session.projectDoc.transact(() => {
      logged = appendProjectLog(session.projectDoc, { actor: origin, label, docs: written });
    }, origin);
  const docs = written.map((w) => w.doc);
  if (origin === session.origin) session.commit({ docs, label });
  return {
    ok: true,
    docs,
    keys: parts.flatMap((p) => p.log.keys),
    ...(logged ? { entry: logged } : {}),
  };
}

/** `revertOpenProjectEntry`, opening the docs the entry names first; they're released after. */
export async function revertProjectEntry(
  session: ProjectSession,
  entryId: string,
  origin: DocOrigin = session.origin,
): Promise<ProjectRevertResult> {
  const entry = readProjectLog(session.projectDoc).find((e) => e.id === entryId);
  if (!entry) return notFound(entryId);
  const names = entry.docs.map((d) => d.doc).filter((n) => n !== session.name);
  const opened: string[] = [];
  try {
    for (const name of names) {
      await session.open(name);
      opened.push(name);
    }
    return revertOpenProjectEntry(session, entryId, origin);
  } finally {
    for (const name of opened) session.release(name);
  }
}

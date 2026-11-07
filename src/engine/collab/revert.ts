import * as Y from "yjs";

import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import type { GroupDef } from "../scene/types";
import {
  entitiesMap,
  groupMap,
  groupsMap,
  instancesMap,
  patchRecord,
  prefabsMap,
  recordMap,
  recordOf,
  sceneMap,
  settingsMap,
} from "./convert";
import { appendLog, fingerprint, sameValue } from "./log";
import {
  GROUP_KEY_PREFIX,
  INSTANCE_KEY_PREFIX,
  PREFAB_KEY_PREFIX,
  SCENE_KEY,
  SETTINGS_KEY,
  type EntityRecord,
  type LogEntry,
  type SceneOrigin,
} from "./types";

/** Which map a log key names, and the key inside it. */
function slotOf(
  doc: Y.Doc,
  key: string,
): { map: Y.Map<unknown>; key: string; kind: "record" | "group" | "value" } {
  if (key.startsWith(INSTANCE_KEY_PREFIX))
    return {
      map: instancesMap(doc) as Y.Map<unknown>,
      key: key.slice(INSTANCE_KEY_PREFIX.length),
      kind: "record",
    };
  if (key.startsWith(GROUP_KEY_PREFIX))
    return {
      map: groupsMap(doc) as Y.Map<unknown>,
      key: key.slice(GROUP_KEY_PREFIX.length),
      kind: "group",
    };
  if (key.startsWith(PREFAB_KEY_PREFIX))
    return { map: prefabsMap(doc), key: key.slice(PREFAB_KEY_PREFIX.length), kind: "value" };
  return { map: entitiesMap(doc) as Y.Map<unknown>, key, kind: "record" };
}

export type RevertResult = { ok: true; keys: string[] } | { ok: false; issue: SceneIssue };

/** The state a log key is in now: a record, the settings, the header, or null when gone. */
function currentOf(doc: Y.Doc, key: string): unknown {
  if (key === SETTINGS_KEY) return settingsMap(doc).toJSON();
  if (key === SCENE_KEY) return sceneMap(doc).toJSON();
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

/**
 * Applies a history entry's inverse as a new batch from `origin`: every key
 * it touched goes back to its state before the entry. Refused with an
 * issue, writing nothing, when any of those keys has changed since, or when
 * the entry was too large to keep its inverse.
 */
export function revertEntry(doc: Y.Doc, entry: LogEntry, origin: SceneOrigin): RevertResult {
  const { before, after } = entry;
  if (!before || !after) {
    return {
      ok: false,
      issue: makeIssue("op-invalid", {
        message: `"${entry.label}" was too large to keep its inverse, so it can't be reverted.`,
      }),
    };
  }
  const changed = entry.keys.filter((key) => {
    const now = currentOf(doc, key);
    const expected = after[key] ?? null;
    return now === null ? expected !== null : expected === null || fingerprint(now) !== expected;
  });
  if (changed.length > 0) {
    return {
      ok: false,
      issue: makeIssue("op-invalid", {
        message: `"${entry.label}" can't be reverted: ${changed.length} of the entities it changed ${changed.length === 1 ? "has" : "have"} changed since.`,
        hint: "Undo or edit those entities by hand, or revert the later entries first.",
      }),
    };
  }
  const undone = Object.fromEntries(entry.keys.map((k) => [k, currentOf(doc, k)]));
  doc.transact(() => {
    for (const key of entry.keys) {
      const prev = before[key] ?? null;
      if (key === SETTINGS_KEY) writeMap(settingsMap(doc), (prev ?? {}) as Record<string, unknown>);
      else if (key === SCENE_KEY) writeMap(sceneMap(doc), (prev ?? {}) as Record<string, unknown>);
      else {
        const slot = slotOf(doc, key);
        const current = slot.map.get(slot.key);
        if (prev === null) slot.map.delete(slot.key);
        else if (slot.kind === "group") slot.map.set(slot.key, groupMap(prev as GroupDef));
        else if (slot.kind === "value") slot.map.set(slot.key, structuredClone(prev));
        else if (current instanceof Y.Map)
          patchRecord(current, recordOf(current), prev as EntityRecord);
        else slot.map.set(slot.key, recordMap(prev as EntityRecord));
      }
    }
    appendLog(doc, {
      actor: origin,
      label: `Revert ${entry.label}`,
      keys: entry.keys,
      kind: "revert",
      before: undone,
      after: Object.fromEntries(
        entry.keys.map((k) => [k, before[k] === null ? null : fingerprint(before[k])]),
      ),
    });
  }, origin);
  return { ok: true, keys: entry.keys };
}

import * as Y from "yjs";

import type { Registry } from "../../game/types";
import { formatScene } from "../../scene/format";
import type { OpBatch, SceneDefinition } from "../../scene/types";
import { applyOpsToDoc, type DocApplyOptions, type DocApplyResult } from "../apply";
import { docToScene, readDoc, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import type { SceneOrigin } from "../types";

export const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
export const bo: SceneOrigin = { kind: "user", userId: "bo", name: "Bo" };
export const agent: SceneOrigin = { kind: "agent", agentId: "claude", onBehalfOf: "ada" };

/** Two docs seeded once by a "server", then synced by hand. */
export function pair(def: SceneDefinition): [Y.Doc, Y.Doc] {
  const server = sceneToDoc(def, { key: sequentialKeys("srv") });
  const a = new Y.Doc();
  const b = new Y.Doc();
  Y.applyUpdate(a, Y.encodeStateAsUpdate(server));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(server));
  return [a, b];
}

/** Exchanges everything both ways, as a reconnect does. */
export function sync(...docs: Y.Doc[]): void {
  for (const from of docs)
    for (const to of docs)
      if (from !== to)
        Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "net");
}

/** Keeps docs in step live: every local update reaches the others at once. */
export function link(...docs: Y.Doc[]): () => void {
  const offs = docs.map((from) => {
    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin === "net") return;
      for (const to of docs) if (to !== from) Y.applyUpdate(to, update, "net");
    };
    from.on("update", handler);
    return () => from.off("update", handler);
  });
  return () => offs.forEach((off) => off());
}

export function must(r: DocApplyResult): Extract<DocApplyResult, { ok: true }> {
  if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
  return r;
}

export const apply = (
  doc: Y.Doc,
  batch: OpBatch,
  origin: SceneOrigin,
  registry: Registry,
  opts?: DocApplyOptions,
) => must(applyOpsToDoc(doc, batch, origin, registry, opts));

export const text = (doc: Y.Doc) => formatScene(docToScene(doc)).text;
export const entity = (doc: Y.Doc, id: string) =>
  docToScene(doc).entities?.find((e) => e.id === id);
export const instance = (doc: Y.Doc, id: string) =>
  docToScene(doc).instances?.find((i) => i.id === id);
export const ids = (doc: Y.Doc) => (docToScene(doc).entities ?? []).map((e) => e.id);

/** The key behind an id or bulk ref in a doc. */
export function keyOf(doc: Y.Doc, ref: string): string | undefined {
  const view = readDoc(doc);
  const m = /^~(.+):(\d+)$/.exec(ref);
  if (m) return view.bulkKeys.get(m[1]!)?.[Number(m[2])];
  return view.entityKeys[(view.def.entities ?? []).findIndex((e) => e.id === ref)];
}

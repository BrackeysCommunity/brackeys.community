import { readFileSync } from "node:fs";

import { expect } from "vite-plus/test";

import { createRegistry } from "../../../game/define";
import type { ContentStore } from "../../../project/content-store";
import { sha256 } from "../../../project/hash";
import { inspectEntry } from "../../../project/inspect/entry";
import { createKindRegistry, type BlobKindDef } from "../../../project/kinds";
import type { ProjectApplyResult } from "../../../project/ops";
import type { AssetEntry, ProjectState } from "../../../project/types";
import { applyProjectBatch } from "../../project-apply";
import { seedProjectDoc } from "../../project-doc";
import { createProjectSession, memoryDocHost, type ProjectSession } from "../../project-session";
import type { DocOrigin } from "../../types";

/**
 * Clients of one in-memory project racing blob replaces: a project doc
 * seeded with blob assets whose bytes are in a shared store, clients that
 * join it with chosen client ids and go offline and back, and the check
 * that an entry's hash, size and meta describe the same bytes.
 */

/** A file of `project/__tests__/fixtures/`. */
export const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../../project/__tests__/fixtures/${name}`, import.meta.url)),
  );

export const kinds = createKindRegistry(null);
export const registry = createRegistry();

export const users: DocOrigin[] = ["ada", "bo", "cy"].map((userId) => ({ kind: "user", userId }));

/** A blob asset the project starts with: its key (also its id), kind, path and bytes. */
export type SeedBlob = { key: string; kind: string; path: string; bytes: Uint8Array };

/** The host of project `p`, seeded with `blobs`, each stored and inspected as its kind. */
export async function world(store: ContentStore, blobs: readonly SeedBlob[]) {
  const host = memoryDocHost();
  const at = { at: 0, by: "seed" };
  const assets: Record<string, AssetEntry> = {};
  for (const { key, kind, path, bytes } of blobs) {
    const e: AssetEntry = {
      key,
      id: key,
      kind,
      path,
      sha256: await store.put(bytes),
      bytes: bytes.byteLength,
      created: at,
    };
    const result = inspectEntry(kinds.get(kind) as BlobKindDef, e, bytes, () => undefined);
    if (result.ok) e.meta = result.meta as Record<string, unknown>;
    assets[key] = e;
  }
  const state: ProjectState = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets,
    history: {},
    code: {},
    build: {},
  };
  seedProjectDoc(host.doc("project:p"), state, { kind: "migration" });
  return host;
}

export type Client = { session: ProjectSession; setOnline(online: boolean): void };

/** A client of `host`'s project; with `clientID`, its project doc writes as that client. */
export async function join(
  host: ReturnType<typeof memoryDocHost>,
  origin: DocOrigin,
  store: ContentStore,
  clientID?: number,
): Promise<Client> {
  const client = host.client();
  const session = await createProjectSession({
    project: "p",
    origin,
    registry,
    kinds,
    store,
    openDoc: async (name) => {
      const opened = await client.openDoc(name);
      if (clientID !== undefined) opened.doc.clientID = clientID;
      return opened;
    },
  });
  return { session, setOnline: (online) => client.setOnline(online) };
}

/** One `replaceContent` of asset `id` with `bytes`, which the store must already hold. */
export const replace = async (s: ProjectSession, id: string, bytes: Uint8Array) =>
  applyProjectBatch(
    s,
    { v: 1, ops: [{ op: "replaceContent", id, sha256: await sha256(bytes), bytes: bytes.length }] },
    s.origin,
  );

export function ok(r: ProjectApplyResult): Extract<ProjectApplyResult, { ok: true }> {
  if (!r.ok) throw new Error(`${r.issue.code} at ${r.opIndex}: ${r.issue.message}`);
  return r;
}

/** The entry's hash, size and meta all describe the bytes the store holds for that hash. */
export async function consistent(store: ContentStore, entry: AssetEntry): Promise<void> {
  const bytes = await store.get(entry.sha256!);
  expect(bytes, "the store keeps the bytes the entry names").not.toBeNull();
  expect(entry.bytes).toBe(bytes!.byteLength);
  const result = inspectEntry(kinds.get(entry.kind) as BlobKindDef, entry, bytes!, () => undefined);
  expect(result.ok && result.meta).toEqual(entry.meta);
}

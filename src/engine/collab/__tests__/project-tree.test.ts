import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import { createRegistry } from "../../game/define";
import { stableJson } from "../../project/canonical";
import { createKindRegistry, defineAssetKind } from "../../project/kinds";
import type { ProjectOp } from "../../project/ops";
import type { AssetEntry, ProjectState } from "../../project/types";
import { projectView } from "../../project/view";
import { rng } from "../../scene/__tests__/fixtures/random-ops";
import { sequentialKeys } from "../keys";
import { applyRegistryBatch, applyRepairs, type RegistryApplyOptions } from "../project-apply";
import {
  projectAssetsMap,
  projectHistoryMap,
  readProject,
  seedProjectDoc,
  writeEntry,
} from "../project-doc";
import { readProjectLog } from "../project-log";
import type { DocOrigin } from "../types";
import { SimNetwork } from "./sim-network";

// ─── Test kinds and fixtures ─────────────────────────────

const note = defineAssetKind({
  storage: "doc",
  kind: "note",
  title: "Note",
  description: "A note.",
  match: { suffixes: [".note.json"] },
  version: 1,
  schemaId: "urn:jams-engine:note:v1",
  schema: () => z.looseObject({ v: z.literal(1) }),
  layout: { as: "map", rest: { as: "atomic" } },
  empty: () => ({ v: 1 }),
});
const texture = defineAssetKind({
  storage: "blob",
  kind: "texture",
  title: "Texture",
  description: "An image.",
  match: { suffixes: [".png"] },
  contentTypes: ["image/png"],
  maxBytes: 1 << 20,
  settings: z.strictObject({
    filter: z.enum(["nearest", "linear"]).optional(),
    pivot: z.number().optional(),
  }),
  meta: z.looseObject({}),
  inspect: () => ({ ok: true as const, meta: {} }),
});
const kinds = createKindRegistry(null, [note, texture]);
const registry = createRegistry();

const H = (c: string) => c.repeat(64);

const seedState: ProjectState = {
  meta: { projectId: "proj", layout: 1, name: "Proj" },
  assets: {
    crate: {
      key: "crate",
      id: "crate",
      kind: "texture",
      path: "art/crate.png",
      sha256: H("a"),
      bytes: 4,
      import: { filter: "nearest" },
      created: { at: 0, by: "seed" },
    },
    intro: {
      key: "intro",
      id: "intro",
      kind: "note",
      path: "intro.note.json",
      licence: { spdx: "CC0-1.0" },
      created: { at: 0, by: "seed" },
    },
  },
  history: {},
  code: { "index.ts": { registers: { types: ["hero"] } } },
  build: {},
};

function seeded(): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = 1;
  seedProjectDoc(doc, seedState, { kind: "migration" });
  return doc;
}

const ada: DocOrigin = { kind: "user", userId: "ada", name: "Ada" };
const bo: DocOrigin = { kind: "user", userId: "bo" };

function opts(extra: Partial<RegistryApplyOptions> = {}): RegistryApplyOptions {
  return { registry, kinds, now: 10, newKey: sequentialKeys("n"), ...extra };
}

const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

const liveOf = (s: ProjectState) => Object.values(s.assets).filter((e) => !e.deleted);

// ─── The project doc ─────────────────────────────────────

describe("the project doc", () => {
  it("round-trips a seeded state, with history arrays ready for blob entries", () => {
    const doc = seeded();
    expect(readProject(doc)).toEqual({ ...seedState, history: { crate: [] } });
    const crate = projectAssetsMap(doc).get("crate")!;
    expect(crate.get("import")).toBeInstanceOf(Y.Map);
    expect(crate.get("licence")).toBeInstanceOf(Y.Map);
    expect(crate.has("key")).toBe(false);
    expect(projectHistoryMap(doc).get("crate")).toBeInstanceOf(Y.Array);
    expect(() => seedProjectDoc(doc, seedState)).toThrow(/isn't empty/);
  });

  it("writes only the fields that changed", () => {
    const doc = seeded();
    const changed: string[] = [];
    projectAssetsMap(doc).observeDeep((events) => {
      for (const e of events) for (const k of e.keys.keys()) changed.push(k);
    });
    const crate = readProject(doc).assets.crate!;
    writeEntry(doc, { ...crate, path: "art/box.png", import: { filter: "nearest", pivot: 1 } });
    expect(changed.sort()).toEqual(["path", "pivot"]);
    writeEntry(doc, { ...crate, path: "art/box.png", import: { filter: "nearest", pivot: 1 } });
    expect(changed).toHaveLength(2);
  });

  it("merges concurrent settings and licence edits per field", () => {
    const a = seeded();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(
      applyRegistryBatch(
        a,
        { v: 1, ops: [{ op: "setImport", id: "crate", set: { pivot: 2 } }] },
        ada,
        opts(),
      ).ok,
    ).toBe(true);
    expect(
      applyRegistryBatch(
        b,
        { v: 1, ops: [{ op: "setImport", id: "crate", set: { filter: "linear" } }] },
        bo,
        opts(),
      ).ok,
    ).toBe(true);
    applyRegistryBatch(
      a,
      {
        v: 1,
        ops: [{ op: "setLicence", id: "intro", licence: { spdx: "CC0-1.0", author: "Ada" } }],
      },
      ada,
      opts(),
    );
    applyRegistryBatch(
      b,
      {
        v: 1,
        ops: [{ op: "setLicence", id: "intro", licence: { spdx: "CC0-1.0", source: "shop" } }],
      },
      bo,
      opts(),
    );
    sync(a, b);
    for (const doc of [a, b]) {
      const s = readProject(doc);
      expect(s.assets.crate!.import).toEqual({ filter: "linear", pivot: 2 });
      expect(s.assets.intro!.licence).toEqual({ spdx: "CC0-1.0", author: "Ada", source: "shop" });
    }
  });

  it("keeps both hashes of two concurrent replaces in one history", () => {
    const a = seeded();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyRegistryBatch(
      a,
      { v: 1, ops: [{ op: "replaceContent", id: "crate", sha256: H("b"), bytes: 5 }] },
      ada,
      opts(),
    );
    applyRegistryBatch(
      b,
      { v: 1, ops: [{ op: "replaceContent", id: "crate", sha256: H("c"), bytes: 6 }] },
      bo,
      opts(),
    );
    sync(a, b);
    const s = readProject(a);
    expect(stableJson(s)).toBe(stableJson(readProject(b)));
    expect([H("b"), H("c")]).toContain(s.assets.crate!.sha256);
    expect(new Set(s.history.crate!.map((h) => h.sha256))).toEqual(
      new Set([H("a"), H("b"), H("c")]),
    );
  });
});

// ─── Applying registry batches ───────────────────────────

describe("applyRegistryBatch", () => {
  it("writes the batch in one transaction with its origin and one log entry", () => {
    const doc = seeded();
    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));
    const result = applyRegistryBatch(
      doc,
      {
        v: 1,
        label: "Tidy",
        ops: [
          { op: "createAsset", kind: "note", path: "notes/a.note.json" },
          { op: "moveAsset", ids: ["crate"], to: "props/" },
          { op: "deleteAsset", id: "intro" },
        ],
      },
      ada,
      opts(),
    );
    if (!result.ok) throw new Error(result.issue.message);
    expect(origins).toEqual([ada]);
    expect(result.docs).toEqual(["project:proj"]);
    expect(result.created).toEqual(["a-note"]);
    expect(result.check.written).toEqual(["n0000"]);
    expect(result.check.values.get("n0000")).toEqual({ v: 1 });
    const state = readProject(doc);
    expect(state).toEqual(result.check.state);
    expect(state.assets.n0000).toMatchObject({ id: "a-note", created: { at: 10, by: "ada" } });
    expect(state.assets.intro!.deleted).toEqual({ at: 10, by: "ada" });
    const log = readProjectLog(doc);
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual(result.entry);
    expect(log[0]).toMatchObject({ actor: ada, label: "Tidy", at: 10 });
    expect(log[0]!.docs).toEqual([{ doc: "project:proj", entry: log[0]!.id }]);
  });

  it("lists the other docs a batch wrote after the project doc", () => {
    const doc = seeded();
    const result = applyRegistryBatch(
      doc,
      { v: 1, ops: [{ op: "createAsset", kind: "note", path: "b.note.json" }] },
      ada,
      opts({ alsoWrote: [{ doc: "asset:proj.n0000", entry: "e1" }] }),
    );
    expect(result.ok && result.entry!.docs.map((d) => d.doc)).toEqual([
      "project:proj",
      "asset:proj.n0000",
    ]);
  });

  it("writes nothing for a refused batch or one that changes nothing", () => {
    const doc = seeded();
    const before = Y.encodeStateVector(doc);
    const refused = applyRegistryBatch(
      doc,
      {
        v: 1,
        ops: [
          { op: "deleteAsset", id: "crate" },
          { op: "deleteAsset", id: "nope" },
        ],
      },
      ada,
      opts(),
    );
    expect(refused).toMatchObject({ ok: false, opIndex: 1 });
    const idle = applyRegistryBatch(
      doc,
      { v: 1, ops: [{ op: "moveAsset", ids: ["crate"], to: "art/" }] },
      ada,
      opts(),
    );
    expect(idle).toMatchObject({ ok: true, docs: [] });
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });
});

// ─── Repairs ─────────────────────────────────────────────

describe("applyRepairs", () => {
  function collided() {
    const a = seeded();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const make: ProjectOp[] = [{ op: "createAsset", kind: "note", path: "notes/plan.note.json" }];
    applyRegistryBatch(a, { v: 1, ops: make }, ada, opts({ newKey: sequentialKeys("a"), now: 20 }));
    applyRegistryBatch(b, { v: 1, ops: make }, bo, opts({ newKey: sequentialKeys("b"), now: 20 }));
    sync(a, b);
    return { a, b };
  }

  it("suffixes the later of two concurrent same-path creates, with a repair origin, once", () => {
    const { a } = collided();
    expect(
      projectView(readProject(a))
        .issues.map((i) => i.code)
        .sort(),
    ).toEqual(["asset-id-taken", "path-taken"]);
    const origins: unknown[] = [];
    a.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));
    const first = applyRepairs(a, { now: 30 });
    expect(first.wrote).toBe(true);
    expect(origins).toEqual([{ kind: "repair", reason: "registry" }]);
    const s = readProject(a);
    expect(s.assets.b0000).toMatchObject({ id: "plan-note-2", path: "notes/plan-2.note.json" });
    expect(s.assets.a0000).toMatchObject({ id: "plan-note", path: "notes/plan.note.json" });
    expect(projectView(s).issues).toEqual([]);
    expect(readProjectLog(a).at(-1)).toMatchObject({ actor: { kind: "repair" }, at: 30 });
    expect(applyRepairs(a)).toMatchObject({ wrote: false, restored: [] });
    expect(origins).toHaveLength(1);
  });

  it("writes the same repair from two writers at once", () => {
    const { a, b } = collided();
    applyRepairs(a);
    applyRepairs(b);
    sync(a, b);
    expect(stableJson(readProject(a))).toBe(stableJson(readProject(b)));
    expect(projectView(readProject(a)).issues).toEqual([]);
  });

  it("restores trashed keys it is given, repairing what the restore collides with", () => {
    const doc = seeded();
    applyRegistryBatch(doc, { v: 1, ops: [{ op: "deleteAsset", id: "intro" }] }, ada, opts());
    applyRegistryBatch(
      doc,
      { v: 1, ops: [{ op: "createAsset", kind: "note", path: "intro.note.json" }] },
      bo,
      opts({ now: 50 }),
    );
    const r = applyRepairs(doc, {
      restore: ["intro", "crate", "ghost"],
      origin: { kind: "repair", reason: "in-use" },
    });
    expect(r.restored).toEqual(["intro"]);
    const s = readProject(doc);
    expect(s.assets.intro!.deleted).toBeUndefined();
    expect(s.assets.n0000).toMatchObject({ id: "intro-note", path: "intro-2.note.json" });
    expect(applyRepairs(doc, { restore: ["intro"] }).wrote).toBe(false);
  });
});

// ─── Item 11: tree convergence ───────────────────────────

const FOLDERS = ["", "art/", "notes/", "Notes/", "levels/a/"];
const NAMES = ["crate", "Crate", "plan", "door", "key"];

function randomOp(rand: () => number, state: ProjectState, i: number): ProjectOp | null {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const live = liveOf(state);
  const trashed = Object.values(state.assets).filter((e) => e.deleted);
  const roll = rand();
  if (roll < 0.3 || live.length === 0) {
    const name = pick(NAMES);
    if (rand() < 0.4)
      return {
        op: "importAsset",
        path: `${pick(FOLDERS)}${name}.png`,
        sha256: H(pick(["a", "b", "c"])),
        bytes: 4,
      };
    return { op: "createAsset", kind: "note", path: `${pick(FOLDERS)}${name}.note.json` };
  }
  const target = pick(live);
  if (roll < 0.5) return { op: "moveAsset", ids: [target.id], to: pick(FOLDERS) };
  if (roll < 0.65) {
    const ext = target.kind === "texture" ? ".png" : ".note.json";
    return rand() < 0.5
      ? { op: "renameAsset", id: target.id, file: `${pick(NAMES)}${ext}` }
      : { op: "renameAsset", id: target.id, name: rand() < 0.3 ? null : `Name ${i}` };
  }
  if (roll < 0.8) return { op: "deleteAsset", id: target.id };
  if (roll < 0.92 && trashed.length > 0) return { op: "restoreAsset", id: pick(trashed).id };
  if (target.kind === "texture")
    return { op: "setImport", id: target.id, set: { filter: pick(["nearest", "linear", null]) } };
  return { op: "setLicence", id: target.id, licence: rand() < 0.3 ? null : { author: `a${i}` } };
}

describe("item 11: project tree convergence", () => {
  it("random creates, moves, renames, deletes and restores converge with no lost entries and repair to no duplicates", () => {
    let applied = 0;
    let collisions = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed * 104729);
      const clients = 2 + (seed % 4);
      const net = new SimNetwork(clients, rand, seeded());
      const keyGens = net.docs.map((_, i) => sequentialKeys(`c${i}x`));
      const created = new Set(Object.keys(seedState.assets));
      for (let step = 0; step < 60; step++) {
        const i = Math.floor(rand() * clients);
        const doc = net.docs[i]!;
        const op = randomOp(rand, readProject(doc), step);
        if (op) {
          const result = applyRegistryBatch(
            doc,
            { v: 1, ops: [op] },
            { kind: "user", userId: `u${i}` },
            opts({ newKey: keyGens[i], now: Math.floor(step / 4) }),
          );
          if (result.ok) {
            applied++;
            for (const key of result.check.written) created.add(key);
            for (const [key, entry] of Object.entries(result.check.state.assets))
              if (!seedState.assets[key] && entry.created.by === `u${i}`) created.add(key);
          }
        }
        net.deliver(Math.floor(rand() * 4));
        const roll = rand();
        if (roll < 0.08) net.partition([Math.floor(rand() * clients)]);
        else if (roll < 0.14) net.heal();
      }
      net.settle();

      const states = net.docs.map(readProject);
      for (const [i, s] of states.entries())
        expect(stableJson(s), `seed ${seed}, client ${i}`).toBe(stableJson(states[0]));
      expect(new Set(Object.keys(states[0]!.assets)), `seed ${seed}: no lost entries`).toEqual(
        created,
      );
      if (projectView(states[0]!).issues.length > 0) collisions++;

      const writers = net.docs.slice(0, 1 + (seed % 2));
      for (const w of writers) applyRepairs(w);
      net.settle();
      const fixed = net.docs.map(readProject);
      for (const s of fixed)
        expect(stableJson(s), `seed ${seed} after repairs`).toBe(stableJson(fixed[0]));
      const view = projectView(fixed[0]!, kinds);
      expect(view.issues, `seed ${seed}`).toEqual([]);
      const live = liveOf(fixed[0]!);
      expect(new Set(live.map((e) => e.id)).size).toBe(live.length);
      expect(new Set(live.map((e) => e.path.toLowerCase())).size).toBe(live.length);
      expect(Object.keys(fixed[0]!.assets).length).toBe(created.size);
      for (const entry of Object.values(fixed[0]!.assets) as AssetEntry[])
        expect(kinds.detect(entry.path, entry.kind === "note" ? { v: 1 } : undefined)?.kind).toBe(
          entry.kind,
        );
    }
    expect(applied).toBeGreaterThan(1000);
    expect(collisions, "the runs must hit concurrent collisions").toBeGreaterThan(5);
  });
});

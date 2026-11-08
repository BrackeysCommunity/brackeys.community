import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry } from "../../game/define";
import { createKindRegistry, defineAssetKind } from "../kinds";
import { checkProjectBatch, type ProjectOp } from "../ops";
import type { ProjectSnapshot } from "../snapshot";
import type { AssetEntry, HashHistoryEntry, ProjectState, ProjectView, Sha256 } from "../types";
import { projectUsage, UNLIMITED_QUOTA, unreferencedBlobs } from "../usage";
import { projectView } from "../view";

const h = (c: string): Sha256 => c.repeat(64);

const DAY = 86_400_000;
const NOW = 100 * DAY;

function entry(key: string, extra: Partial<AssetEntry> = {}): AssetEntry {
  return {
    key,
    id: key,
    kind: extra.sha256 ? "texture" : "material",
    path: key,
    created: { at: 0, by: "test" },
    ...extra,
  };
}

function viewOf(
  entries: AssetEntry[],
  history: Record<string, HashHistoryEntry[]> = {},
): ProjectView {
  const live = entries.filter((e) => !e.deleted);
  return {
    state: {
      meta: { projectId: "test", layout: 1, name: "Test" },
      assets: Object.fromEntries(entries.map((e) => [e.key, e])),
      history,
      code: {},
      build: {},
    },
    byId: new Map(live.map((e) => [e.id, e])),
    byPath: new Map(live.map((e) => [e.path, e])),
    byKey: new Map(entries.map((e) => [e.key, e])),
    deleted: entries.filter((e) => e.deleted),
    issues: [],
    repairs: new Map(),
    tree: () => [],
  };
}

const replaced = (sha256: Sha256, at: number, bytes = 10): HashHistoryEntry => ({
  sha256,
  bytes,
  at,
  by: "test",
});

function snapshot(hashes: Sha256[]): ProjectSnapshot {
  return {
    kind: "project-snapshot",
    v: 1,
    project: "test",
    engine: "0.0.0",
    at: 0,
    build: {},
    assets: Object.fromEntries(
      hashes.map((sha256, i) => [
        `a${i}`,
        { key: `a${i}`, kind: "texture", path: `a${i}.png`, sha256 },
      ]),
    ),
    hash: h("f"),
  };
}

describe("unreferencedBlobs", () => {
  const view = viewOf(
    [
      entry("live", { sha256: h("1"), bytes: 10 }),
      entry("binned", { sha256: h("2"), bytes: 10, deleted: { at: DAY, by: "test" } }),
      entry("doc"),
    ],
    {
      live: [
        replaced(h("3"), NOW - 30 * DAY),
        replaced(h("4"), NOW - DAY),
        replaced(h("5"), NOW - 30 * DAY),
      ],
      binned: [replaced(h("6"), NOW - 30 * DAY)],
    },
  );
  const stored = [h("1"), h("2"), h("3"), h("4"), h("5"), h("6"), h("7"), h("3")];

  it("lists replaced blobs past the grace period and blobs nothing names", () => {
    expect(unreferencedBlobs(view, stored, { now: NOW, graceMs: 7 * DAY, pinned: [] })).toEqual([
      h("3"),
      h("5"),
      h("6"),
      h("7"),
    ]);
  });

  it("keeps a blob inside the grace period", () => {
    expect(unreferencedBlobs(view, stored, { now: NOW, graceMs: 30 * DAY, pinned: [] })).toEqual([
      h("7"),
    ]);
    expect(unreferencedBlobs(view, [h("4")], { now: NOW, graceMs: DAY, pinned: [] })).toEqual([]);
    expect(unreferencedBlobs(view, [h("4")], { now: NOW, graceMs: DAY - 1, pinned: [] })).toEqual([
      h("4"),
    ]);
  });

  it("keeps a blob a pinned snapshot holds", () => {
    expect(
      unreferencedBlobs(view, stored, {
        now: NOW,
        graceMs: 7 * DAY,
        pinned: [snapshot([h("1"), h("5")]), snapshot([h("7")])],
      }),
    ).toEqual([h("3"), h("6")]);
  });

  it("keeps every current hash, live or trashed, whatever the grace", () => {
    expect(unreferencedBlobs(view, [h("1"), h("2")], { now: NOW, graceMs: 0, pinned: [] })).toEqual(
      [],
    );
  });
});

describe("unreferencedBlobs over replaceContent ops", () => {
  const kinds = createKindRegistry(null, [
    defineAssetKind({
      storage: "blob",
      kind: "texture",
      title: "Texture",
      description: "A texture.",
      match: { suffixes: [".png"] },
      contentTypes: ["image/png"],
      maxBytes: 1000,
      settings: z.strictObject({}),
      meta: z.looseObject({}),
      inspect: () => ({ ok: true as const, meta: {} }),
    }),
  ]);
  const start: ProjectState = {
    meta: { projectId: "test", layout: 1, name: "Test" },
    assets: { crate: entry("crate", { path: "crate.png", sha256: h("a"), bytes: 10 }) },
    history: {},
    code: {},
    build: {},
  };
  const replace = (state: ProjectState, sha256: Sha256, now: number): ProjectState => {
    const ops: ProjectOp[] = [{ op: "replaceContent", id: "crate", sha256, bytes: 10 }];
    const env = { registry: createRegistry(), kinds, now, by: "test", newKey: () => "k" };
    const result = checkProjectBatch(state, new Map(), { v: 1, ops }, env);
    if (!result.ok) throw new Error(result.issue.message);
    return result.state;
  };
  const sweep = (state: ProjectState, now: number) =>
    unreferencedBlobs(projectView(state, kinds), [h("a"), h("b"), h("c")], {
      now,
      graceMs: 7 * DAY,
      pinned: [],
    });

  it("keeps a hash that was current for long and was replaced inside the grace period", () => {
    const later = replace(replace(start, h("b"), DAY), h("c"), 60 * DAY);
    expect(sweep(later, 60 * DAY + 3_600_000)).toEqual([h("a")]);
    expect(sweep(later, 67 * DAY + 1)).toEqual([h("a"), h("b")]);
  });

  it("times a hash by its latest replacement when content goes back and forth", () => {
    let state = replace(start, h("b"), DAY);
    state = replace(state, h("a"), 2 * DAY);
    state = replace(state, h("b"), 60 * DAY);
    expect(sweep(state, 60 * DAY + 3_600_000)).toEqual([h("c")]);
    expect(sweep(state, 67 * DAY + 1)).toEqual([h("a"), h("c")]);
  });
});

describe("projectUsage", () => {
  it("counts docs, distinct blobs and what emptying the trash frees", () => {
    const view = viewOf(
      [
        entry("doc-a"),
        entry("doc-b", { deleted: { at: 1, by: "test" } }),
        entry("doc-c"),
        entry("img", { sha256: h("1"), bytes: 100 }),
        entry("copy", { sha256: h("1"), bytes: 100 }),
        entry("old", { sha256: h("2"), bytes: 40, deleted: { at: 1, by: "test" } }),
        entry("shared", { sha256: h("4"), bytes: 7, deleted: { at: 1, by: "test" } }),
      ],
      {
        img: [replaced(h("3"), 0, 30), replaced(h("4"), 0, 7)],
        old: [replaced(h("5"), 0, 5)],
      },
    );
    const usage = projectUsage(
      view,
      new Map([
        ["doc-a", 1000],
        ["doc-b", 200],
      ]),
    );
    expect(usage).toEqual({
      docs: 3,
      docBytes: 1200,
      blobs: 5,
      blobBytes: 100 + 40 + 30 + 7 + 5,
      trashBytes: 200 + 40 + 5,
    });
  });

  it("is all zeros for an empty project", () => {
    expect(projectUsage(viewOf([]), new Map())).toEqual({
      docs: 0,
      docBytes: 0,
      blobs: 0,
      blobBytes: 0,
      trashBytes: 0,
    });
  });
});

describe("UNLIMITED_QUOTA", () => {
  it("admits anything", () => {
    const usage = projectUsage(viewOf([]), new Map());
    expect(UNLIMITED_QUOTA.check(usage, { blobBytes: Number.MAX_SAFE_INTEGER })).toEqual({
      ok: true,
    });
  });
});

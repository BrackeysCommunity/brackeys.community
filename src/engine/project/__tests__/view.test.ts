import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { rng } from "../../scene/__tests__/fixtures/random-ops";
import { createKindRegistry, defineAssetKind } from "../kinds";
import type { AssetEntry, ProjectState } from "../types";
import {
  assetIdOfPath,
  assetPathProblem,
  projectView,
  splitExtension,
  suffixedId,
  suffixedPath,
} from "../view";

const note = defineAssetKind({
  storage: "doc",
  kind: "note",
  title: "Note",
  description: "A test doc kind.",
  match: { suffixes: [".note.json"] },
  version: 1,
  schemaId: "urn:jams-engine:note:v1",
  schema: () => z.looseObject({}),
  layout: { as: "map", rest: { as: "atomic" } },
  empty: () => ({ kind: "note", v: 1 }),
});
const kinds = createKindRegistry(null, [note]);

let n = 0;
function entry(id: string, path: string, at: number, extra: Partial<AssetEntry> = {}): AssetEntry {
  return {
    key: extra.key ?? `k${n++}`,
    id,
    kind: "note",
    path,
    created: { at, by: "t" },
    ...extra,
  };
}

function state(entries: AssetEntry[], code: ProjectState["code"] = {}): ProjectState {
  return {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code,
    build: {},
  };
}

/** The state with the view's repairs written. */
function repaired(s: ProjectState): ProjectState {
  const { repairs } = projectView(s);
  const assets = { ...s.assets };
  for (const [key, fix] of repairs) assets[key] = { ...assets[key]!, ...fix };
  return { ...s, assets };
}

describe("paths", () => {
  it("validates asset paths", () => {
    expect(assetPathProblem("sprites/crate.png")).toBeNull();
    expect(assetPathProblem("My Art/hero_1.png")).toBeNull();
    for (const bad of ["", "/a.png", "a\\b.png", "a/../b.png", "./a.png", "a//b.png", "a/b?.png"])
      expect(assetPathProblem(bad), bad).not.toBeNull();
    expect(assetPathProblem(`${"a".repeat(97)}.png`)).not.toBeNull();
    expect(assetPathProblem(`${"abcd/".repeat(52)}x.png`)).toMatch(/255/);
  });

  it("splits at the first dot, keeping a kind's whole suffix", () => {
    expect(splitExtension("crate.png")).toEqual(["crate", ".png"]);
    expect(splitExtension("yard.checks.json")).toEqual(["yard", ".checks.json"]);
    expect(splitExtension("README")).toEqual(["README", ""]);
    expect(splitExtension(".hidden.json")).toEqual([".hidden", ".json"]);
  });

  it("suffixes before the extension and stays within the limits", () => {
    expect(suffixedPath("a/yard.checks.json", 2)).toBe("a/yard-2.checks.json");
    expect(suffixedPath("crate.png", 3)).toBe("crate-3.png");
    const long = `${"x".repeat(92)}.png`;
    expect(suffixedPath(long, 2).length).toBe(96);
    expect(suffixedId("a".repeat(48), 2)).toBe(`${"a".repeat(46)}-2`);
  });

  it("gives ids from file stems", () => {
    expect(assetIdOfPath("scenes/engine-yard.json")).toBe("engine-yard");
    expect(assetIdOfPath("Hero Idle.png")).toBe("hero-idle");
    expect(assetIdOfPath("engine-yard.checks.json")).toBe("engine-yard-checks");
    expect(assetIdOfPath("font_0.png")).toBe("font-0");
    expect(assetIdOfPath("___.png")).toBeNull();
  });
});

describe("projectView", () => {
  it("resolves live entries by id, path and key, and lists the trash", () => {
    const a = entry("crate", "crate.note.json", 1);
    const b = entry("barrel", "props/barrel.note.json", 2, {
      deleted: { at: 5, by: "t" },
    });
    const view = projectView(state([a, b]));
    expect(view.byId.get("crate")).toEqual(a);
    expect(view.byId.has("barrel")).toBe(false);
    expect(view.byPath.get("crate.note.json")).toEqual(a);
    expect(view.byKey.get(b.key)).toEqual(b);
    expect(view.deleted).toEqual([b]);
    expect(view.issues).toEqual([]);
    expect(view.repairs.size).toBe(0);
  });

  it("keeps the first of a duplicated id and repairs the rest past every taken id", () => {
    const first = entry("crate", "a.note.json", 1);
    const second = entry("crate", "b.note.json", 2);
    const third = entry("crate", "c.note.json", 3);
    const holder = entry("crate-2", "d.note.json", 4, { deleted: { at: 9, by: "t" } });
    const view = projectView(state([third, second, first, holder]));
    expect(view.byId.get("crate")).toEqual(first);
    expect(view.issues.map((i) => [i.code, i.entityIds])).toEqual([
      ["asset-id-taken", [first.key, second.key]],
      ["asset-id-taken", [first.key, third.key]],
    ]);
    expect(view.repairs.get(second.key)).toEqual({ id: "crate-3" });
    expect(view.repairs.get(third.key)).toEqual({ id: "crate-4" });
  });

  it("breaks a created.at tie by key", () => {
    const b = entry("crate", "b.note.json", 1, { key: "kb" });
    const a = entry("crate", "a.note.json", 1, { key: "ka" });
    const view = projectView(state([b, a]));
    expect(view.byId.get("crate")!.key).toBe("ka");
    expect([...view.repairs.keys()]).toEqual(["kb"]);
  });

  it("repairs a duplicated path with a suffix before the extension", () => {
    const first = entry("a", "props/crate.note.json", 1);
    const second = entry("b", "props/crate.note.json", 2);
    const view = projectView(state([second, first]));
    expect(view.byPath.get("props/crate.note.json")).toEqual(first);
    expect(view.issues.map((i) => i.code)).toEqual(["path-taken"]);
    expect(view.issues[0]!.entityIds).toEqual([first.key, second.key]);
    expect(view.repairs.get(second.key)).toEqual({ path: "props/crate-2.note.json" });
  });

  it("treats paths that differ only in case as taken", () => {
    const first = entry("a", "Props/Crate.note.json", 1);
    const second = entry("b", "props/crate.note.json", 2);
    const taken = entry("c", "PROPS/CRATE-2.note.json", 3, { deleted: { at: 4, by: "t" } });
    const view = projectView(state([first, second, taken]));
    expect(view.byPath.get("props/crate.note.json")).toEqual(second);
    expect(view.issues[0]!.message).toMatch(/differs only in case/);
    expect(view.repairs.get(second.key), "into the first entry's spelling of the folder").toEqual({
      path: "Props/crate-3.note.json",
    });
  });

  it("treats folders that differ only in case as taken, moving later files under the first spelling", () => {
    const first = entry("a", "Art/a.note.json", 1);
    const second = entry("b", "art/b.note.json", 2);
    const deep = entry("c", "art/Sprites/c.note.json", 3);
    const deeper = entry("d", "Art/sprites/d.note.json", 4);
    const view = projectView(state([deeper, second, first, deep]));
    expect(view.issues.map((i) => [i.code, i.entityIds, i.got, i.expected])).toEqual([
      ["path-taken", [first.key, second.key], "art/b.note.json", "Art/b.note.json"],
      ["path-taken", [first.key, deep.key], "art/Sprites/c.note.json", "Art/Sprites/c.note.json"],
      ["path-taken", [deep.key, deeper.key], "Art/sprites/d.note.json", "Art/Sprites/d.note.json"],
    ]);
    expect(view.issues[0]!.message).toBe(
      `"art/b.note.json" (b) is in the folder "art", which differs only in case from "Art", where "Art/a.note.json" (a) is; the later one moves to "Art/b.note.json" when the project's server repairs it`,
    );
    expect(view.byPath.get("art/b.note.json")).toEqual(second);

    const fixed = projectView(repaired(state([deeper, second, first, deep])));
    expect(fixed.issues).toEqual([]);
    const folders = fixed.tree().filter((node) => node.type === "folder");
    expect(folders.map((node) => node.path)).toEqual(["Art"]);
  });

  it("reports a second game-settings asset as asset-kind when kinds are given", () => {
    const settings = (id: string, path: string, at: number) =>
      entry(id, path, at, { kind: "game-settings" });
    const later = settings("extra", "more/settings.json", 1);
    const kept = settings("settings", "game-settings.json", 2);
    expect(projectView(state([later, kept])).issues).toEqual([]);
    const issues = projectView(state([later, kept]), createKindRegistry(null)).issues;
    expect(issues.map((i) => [i.code, i.entityIds, i.got])).toEqual([
      ["asset-kind", [later.key], "more/settings.json"],
    ]);
    expect(issues[0]!.message).toBe(
      `"extra" is a second game-settings asset; "settings" (game-settings.json) is the project's`,
    );
    const alone = projectView(state([kept]), createKindRegistry(null)).issues;
    expect(alone).toEqual([]);
  });

  it("ignores trashed entries for collisions", () => {
    const live = entry("crate", "crate.note.json", 2);
    const gone = entry("crate", "crate.note.json", 1, { deleted: { at: 3, by: "t" } });
    const view = projectView(state([live, gone]));
    expect(view.issues).toEqual([]);
    expect(view.byId.get("crate")).toEqual(live);
  });

  it("reports an unregistered kind only when kinds are given", () => {
    const odd = entry("odd", "odd.bin", 1, { kind: "mystery" });
    expect(projectView(state([odd])).issues).toEqual([]);
    const issues = projectView(state([odd]), kinds).issues;
    expect(issues.map((i) => [i.code, i.entityIds])).toEqual([["asset-kind", [odd.key]]]);
  });

  it("repairs deterministically, whatever order the state lists entries in, and repairs settle", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed);
      const ids = ["crate", "crate-2", "barrel", "door"];
      const paths = [
        "a.note.json",
        "A.note.json",
        "a-2.note.json",
        "x/b.note.json",
        "x/B.note.json",
        "X/c.note.json",
        "x/Y/d.note.json",
        "X/y/e.note.json",
      ];
      const entries = Array.from({ length: 12 }, (_, i) =>
        entry(
          ids[Math.floor(rand() * ids.length)]!,
          paths[Math.floor(rand() * paths.length)]!,
          Math.floor(rand() * 4),
          {
            key: `s${seed}k${i}`,
            ...(rand() < 0.2 ? { deleted: { at: 9, by: "t" } } : {}),
          },
        ),
      );
      const shuffled = [...entries].sort(() => rand() - 0.5);
      const one = projectView(state(entries));
      const two = projectView(state(shuffled));
      expect([...two.repairs], `seed ${seed}`).toEqual([...one.repairs]);
      const fixed = projectView(repaired(state(entries)));
      expect(fixed.issues, `seed ${seed}`).toEqual([]);
      expect(fixed.repairs.size).toBe(0);
      const live = Object.values(fixed.state.assets).filter((e) => !e.deleted);
      expect(new Set(live.map((e) => e.id)).size).toBe(live.length);
      expect(new Set(live.map((e) => e.path.toLowerCase())).size).toBe(live.length);
      const spellings = new Map<string, string>();
      for (const e of live)
        for (let i = e.path.indexOf("/"); i > 0; i = e.path.indexOf("/", i + 1)) {
          const folder = e.path.slice(0, i);
          const known = spellings.get(folder.toLowerCase()) ?? folder;
          expect(known, `seed ${seed}: one spelling per folder`).toBe(folder);
          spellings.set(folder.toLowerCase(), folder);
        }
    }
  });
});

describe("tree", () => {
  it("nests folders first, then files by name, with code modules and no trash", () => {
    const s = state(
      [
        entry("b", "b.note.json", 1),
        entry("crate", "props/crate.note.json", 1),
        entry("door", "props/doors/door.note.json", 1),
        entry("Apple", "props/Apple.note.json", 1),
        entry("gone", "props/gone.note.json", 1, { deleted: { at: 2, by: "t" } }),
      ],
      { "index.ts": { registers: { types: ["hero"] } } },
    );
    const tree = projectView(s).tree();
    const shape = (
      nodes: ReturnType<typeof projectView>["tree"] extends () => infer T ? T : never,
    ): unknown =>
      nodes.map((node) =>
        node.type === "folder"
          ? { [node.path]: shape(node.children) }
          : node.type === "asset"
            ? node.entry.path
            : `code:${node.path}`,
      );
    expect(shape(tree)).toEqual([
      {
        props: [
          { "props/doors": ["props/doors/door.note.json"] },
          "props/Apple.note.json",
          "props/crate.note.json",
        ],
      },
      "b.note.json",
      "code:index.ts",
    ]);
  });
});

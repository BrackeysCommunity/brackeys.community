import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import type { Registry } from "../../game/types";
import { formatScene } from "../format";
import { parseFragment } from "../fragment";
import { MIGRATIONS, migrate } from "../migrate";
import { parseScene } from "../parse";
import { parsePrefab } from "../prefab";
import { SCENE_FORMAT_VERSION } from "../types";
import { engine } from "./fixtures/fake-game";

const FIXTURES = new URL("./fixtures/", import.meta.url);

/**
 * sha-256 of every frozen fixture. A fixture is the format as it was
 * released, so it never changes: a new format version adds a `v<n>` folder
 * instead.
 */
const FROZEN: Record<string, string> = {
  "v1/engine-yard.json": "c560fc9a7c5c2f49c3957596e61e1fd1525da7c9894311c4231b781c6edcd80c",
  "v1/grouped.json": "3cee009bc08ba275221a8852252885fcc63c8e1dab9eb9c9baee0427555abf19",
  "v2/prefabbed.json": "3414c1a360240651ecc93751d0f83903dd5584e1981f8d0240f2f722e167fffe",
  "v3/engine-yard.json": "db031ac03957ad0c0d3f521feec8673f7a18a14a065988ca03d8c602e5252729",
  "v3/grouped.json": "0679ce3cf806dcaa1b835eebbcc514ca05b77605a2fbb0134ec54b7b2996d464",
  "v3/kitchen-sink.json": "096c23f5ad8164ecdaa23d692497d564d16d280b438e157538df82eb72dfb586",
  "v3/prefabbed.json": "ac52240a501e331e8d119b3b5409b1c757115740baaa067bac55f4cdbd15e367",
  "v3/test-game-sink.json": "bfe224af3384b43021fc3b84d0cc9fe6f3ccb36498cddbbbdef71257c48f8970",
};

const frozenText = (file: string) => readFileSync(new URL(file, FIXTURES), "utf8");

const testGameRegistry = createRegistry(testGame);
const registryOf = (text: string): Registry =>
  (JSON.parse(text) as { game?: unknown }).game === "test-game" ? testGameRegistry : engine;

describe("migrate", () => {
  it("passes a current document through", () => {
    const raw = { v: 3, name: "x" };
    expect(migrate(raw)).toEqual({ ok: true, raw, from: 3 });
    expect(Object.keys(MIGRATIONS)).toEqual(["1", "2"]);
  });

  it("v1 to v2 declares each group a v1 entity names at [0, 0], so nothing moves", () => {
    const raw = JSON.parse(frozenText("v1/grouped.json")) as Record<string, unknown>;
    const r = migrate(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe(1);
    const out = MIGRATIONS[1]!(raw) as Record<string, unknown>;
    expect(out.v).toBe(2);
    expect(out.groups).toEqual({ markers: { at: [0, 0] }, posts: { at: [0, 0] } });
    expect(out.entities).toEqual(raw.entities);
    expect(migrate({ v: 1, name: "x" })).toEqual({ ok: true, raw: { v: 3, name: "x" }, from: 1 });
    expect(raw.v).toBe(1);
  });

  it("v2 to v3 changes only v, on scenes, prefabs and fragments alike", () => {
    const scene = JSON.parse(frozenText("v2/prefabbed.json")) as Record<string, unknown>;
    const prefab = {
      kind: "prefab",
      v: 2,
      id: "gate",
      entities: [{ id: "bar", type: "solid", shape: ["box", 0, 0, 40, 6] }],
    };
    const fragment = {
      kind: "scene-fragment",
      v: 2,
      entities: [{ id: "start", type: "marker", at: [0, 0] }],
    };
    for (const raw of [scene, prefab, fragment, { v: 2 }]) {
      const before = structuredClone(raw);
      const r = migrate(raw);
      expect(r).toEqual({ ok: true, raw: { ...before, v: 3 }, from: 2 });
      expect(raw).toEqual(before);
    }
    const parsedPrefab = parsePrefab(JSON.stringify(prefab), engine);
    expect(parsedPrefab.ok && parsedPrefab.migratedFrom).toBe(2);
    expect(parsedPrefab.ok && parsedPrefab.prefab.v).toBe(3);
    const parsedFragment = parseFragment(JSON.stringify(fragment), engine);
    expect(parsedFragment.ok && parsedFragment.migratedFrom).toBe(2);
    expect(parsedFragment.ok && parsedFragment.fragment.v).toBe(3);
  });

  it("rejects a missing or invalid v as schema", () => {
    for (const raw of [{}, { v: "1" }, { v: 0 }, { v: 1.5 }, [], null]) {
      const r = migrate(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issue.code).toBe("schema");
    }
  });

  it("refuses a newer version", () => {
    const r = migrate({ v: SCENE_FORMAT_VERSION + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue.code).toBe("version-newer");
      expect(r.issue.path).toBe("/v");
    }
  });

  it("runs each step in order up to the target", () => {
    const steps = {
      1: (raw: unknown) => ({ ...(raw as object), v: 2, a: true }),
      2: (raw: unknown) => ({ ...(raw as object), v: 3, b: true }),
    };
    expect(migrate({ v: 1 }, steps, 3)).toEqual({
      ok: true,
      raw: { v: 3, a: true, b: true },
      from: 1,
    });
    const gap = migrate({ v: 1 }, { 1: steps[1] }, 3);
    expect(gap.ok === false && gap.issue.message).toContain("v2 to v3");
  });
});

describe("the migration harness", () => {
  it("has one step per version and a frozen fixture folder per version", () => {
    const steps = Object.keys(MIGRATIONS).map(Number);
    expect(steps).toEqual(Array.from({ length: SCENE_FORMAT_VERSION - 1 }, (_, i) => i + 1));
    const folders = readdirSync(FIXTURES).filter((f) => /^v\d+$/.test(f));
    expect(folders.sort()).toEqual(
      Array.from({ length: SCENE_FORMAT_VERSION }, (_, i) => `v${i + 1}`).sort(),
    );
  });

  it("keeps every frozen fixture byte for byte", () => {
    const files = readdirSync(FIXTURES)
      .filter((f) => /^v\d+$/.test(f))
      .flatMap((v) => readdirSync(new URL(`${v}/`, FIXTURES)).map((f) => `${v}/${f}`));
    expect(files.sort()).toEqual(Object.keys(FROZEN).sort());
    for (const [file, sha] of Object.entries(FROZEN))
      expect(createHash("sha256").update(frozenText(file)).digest("hex"), file).toBe(sha);
  });

  for (const file of Object.keys(FROZEN)) {
    it(`walks ${file} to the current version and round-trips it`, () => {
      const from = Number(file.slice(1, file.indexOf("/")));
      const parsed = parseScene(frozenText(file), registryOf(frozenText(file)));
      expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.def.v).toBe(SCENE_FORMAT_VERSION);
      expect(parsed.migratedFrom).toBe(from === SCENE_FORMAT_VERSION ? undefined : from);
      const { text } = formatScene(parsed.def);
      const again = parseScene(text, registryOf(text));
      expect(again.ok && formatScene(again.def).text).toBe(text);
      if (from === SCENE_FORMAT_VERSION) expect(text).toBe(frozenText(file));
    });
  }

  it("composes steps on a real fixture", () => {
    const steps = {
      1: (raw: unknown) => {
        const { bounds, ...rest } = raw as Record<string, unknown>;
        return { ...rest, v: 2, rect: bounds };
      },
      2: (raw: unknown) => {
        const { rect, ...rest } = raw as Record<string, unknown>;
        return { ...rest, v: 3, bounds: rect, migrated: true };
      },
    };
    const raw = JSON.parse(frozenText("v1/engine-yard.json")) as Record<string, unknown>;
    const r = migrate(raw, steps, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe(1);
    expect(r.raw).toEqual({ ...raw, v: 3, migrated: true });
    expect(raw.v).toBe(1);
  });
});

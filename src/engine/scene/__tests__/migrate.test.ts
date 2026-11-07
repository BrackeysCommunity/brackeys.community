import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { formatScene } from "../format";
import { MIGRATIONS, migrate } from "../migrate";
import { parseScene } from "../parse";
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
};

const frozenText = (file: string) => readFileSync(new URL(file, FIXTURES), "utf8");

describe("migrate", () => {
  it("passes a current document through", () => {
    const raw = { v: 2, name: "x" };
    expect(migrate(raw)).toEqual({ ok: true, raw, from: 2 });
    expect(Object.keys(MIGRATIONS)).toEqual(["1"]);
  });

  it("v1 to v2 declares each group a v1 entity names at [0, 0], so nothing moves", () => {
    const raw = JSON.parse(frozenText("v1/grouped.json")) as Record<string, unknown>;
    const r = migrate(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe(1);
    const out = r.raw as Record<string, unknown>;
    expect(out.v).toBe(2);
    expect(out.groups).toEqual({ markers: { at: [0, 0] }, posts: { at: [0, 0] } });
    expect(out.entities).toEqual(raw.entities);
    expect(migrate({ v: 1, name: "x" })).toEqual({ ok: true, raw: { v: 2, name: "x" }, from: 1 });
    expect(raw.v).toBe(1);
  });

  it("rejects a missing or invalid v as schema", () => {
    for (const raw of [{}, { v: "1" }, { v: 0 }, { v: 1.5 }, [], null]) {
      const r = migrate(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issue.code).toBe("schema");
    }
  });

  it("refuses a newer version", () => {
    const r = migrate({ v: 3 });
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
      const parsed = parseScene(frozenText(file), engine);
      expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.def.v).toBe(SCENE_FORMAT_VERSION);
      expect(parsed.migratedFrom).toBe(from === SCENE_FORMAT_VERSION ? undefined : from);
      const { text } = formatScene(parsed.def);
      const again = parseScene(text, engine);
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

import { describe, expect, it } from "vite-plus/test";

import { mutateSynth } from "../../audio/synth-presets";
import * as game from "../../game/index";
import { docLookupOf } from "../../project/kinds/define";
import { synthField, withSynthField, type SynthFile } from "../../project/kinds/synth";
import type { AssetEntry } from "../../project/types";
import { ENGINE_STEP_EVENTS } from "../../runtime/types";
import { Rng } from "../../sim-kit/rng";

const PATCH: SynthFile = {
  kind: "synth",
  v: 1,
  wave: "square",
  freq: 440,
  jump: { atMs: 40, semitones: 5 },
  sustainMs: 60,
  decayMs: 120,
};

describe("the engine's step events", () => {
  it("lists every event constant the game entry exports, and nothing else", () => {
    const exported = Object.values(game).filter(
      (v): v is string => typeof v === "string" && /^[a-z]+:[a-z-]+$/.test(v),
    );
    expect(exported.length).toBeGreaterThan(20);
    expect([...ENGINE_STEP_EVENTS].sort()).toEqual([...new Set(exported)].sort());
  });
});

describe("a patch's dot-path fields", () => {
  it("reads a top-level or a block's number, undefined when it or its block is unset", () => {
    expect(synthField(PATCH, "freq")).toBe(440);
    expect(synthField(PATCH, "jump.semitones")).toBe(5);
    expect(synthField(PATCH, "vibrato.hz")).toBeUndefined();
    expect(synthField(PATCH, "punch")).toBeUndefined();
  });

  it("writes a copy, its blocks copied on the way, and removes a field set to undefined", () => {
    const before = structuredClone(PATCH);
    const moved = withSynthField(PATCH, "jump.atMs", 80);
    expect(moved.jump).toEqual({ atMs: 80, semitones: 5 });
    expect(PATCH).toEqual(before);
    expect(moved.jump).not.toBe(PATCH.jump);
    expect(withSynthField(PATCH, "vibrato.hz", 6).vibrato).toEqual({ hz: 6 });
    expect("jump" in withSynthField(PATCH, "jump", undefined)).toBe(false);
  });

  it("leaves the patch a mutation starts from as it was", () => {
    const before = structuredClone(PATCH);
    const mutated = mutateSynth(PATCH, Rng.from(7));
    expect(PATCH).toEqual(before);
    expect(mutated).not.toEqual(PATCH);
  });
});

describe("a lookup over entries", () => {
  const created = { at: 1, by: "seed" };
  const entry = (id: string, kind: string): AssetEntry => ({
    key: `k${id}`,
    id,
    kind,
    path: `${id}.json`,
    created,
  });

  it("lists every entry's id by kind in order, holding only the values found", () => {
    const values = new Map<string, unknown>([["a", { n: 1 }]]);
    const lookup = docLookupOf([entry("a", "strings"), entry("b", "strings")], (e) =>
      values.get(e.id),
    );
    expect(lookup.ids("strings")).toEqual(["a", "b"]);
    expect(lookup.read("strings", "a")).toEqual({ n: 1 });
    expect(lookup.read("strings", "b")).toBeUndefined();
    expect(lookup.ids("dialogue")).toEqual([]);
  });
});

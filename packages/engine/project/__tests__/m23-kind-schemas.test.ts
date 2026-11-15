// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { GATE_DIALOGUE } from "../../__tests__/fixtures/dialogue/gate";
import { createRegistry } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { undescribedProperties } from "../../scene/json-schema";
import { docKindJsonSchema, validateAssetDoc, type DocKindDef, type KindEnv } from "../kinds";
import { dialogueKind } from "../kinds/dialogue";
import { soundKind } from "../kinds/sound";
import { stringsKind } from "../kinds/strings";
import { synthKind } from "../kinds/synth";

const env: KindEnv = { registry: createRegistry(), project: null };

/** Each kind, its committed schema file and a file of its kind that parses. */
const KINDS: readonly { kind: DocKindDef; sample: unknown }[] = [
  {
    kind: soundKind,
    sample: {
      kind: "sound",
      v: 1,
      bus: "sfx",
      volume: 0.8,
      pitch: [0.95, 1.05],
      variants: [{ clip: "hit-1", weight: 2 }, { clip: "hit-2" }],
      cooldownMs: 40,
      maxVoices: 4,
      positional: true,
      caption: "caption.hit",
      on: [
        { event: "contact:start", type: "crate" },
        { event: "anim:frame", data: { event: "swing" } },
      ],
    },
  },
  {
    kind: synthKind,
    sample: {
      kind: "synth",
      v: 1,
      wave: "square",
      duty: 0.5,
      freq: 880,
      jump: { atMs: 60, semitones: 5 },
      sustainMs: 60,
      punch: 0.4,
      decayMs: 240,
    },
  },
  { kind: dialogueKind, sample: GATE_DIALOGUE },
  {
    kind: stringsKind,
    sample: {
      kind: "strings",
      v: 1,
      strings: [
        { key: "intro.hello", en: "Hello, {name}.", fr: "Bonjour, {name}." },
        { key: "caption.hit", en: "[Thud]", note: "Caption for crate hits." },
      ],
    },
  },
];

const CASES = KINDS.map((k) => ({ ...k, name: `${k.kind.kind}.schema.json` }));

describe.each(CASES)("$name", ({ kind, sample }) => {
  const file = new URL(`../${kind.kind}.schema.json`, import.meta.url);
  const fresh = () => docKindJsonSchema(kind, env);

  it("matches the committed file (UPDATE_SCHEMAS=1 regenerates)", () => {
    const schema = fresh();
    if (process.env.UPDATE_SCHEMAS) writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(schema);
  });

  it("has its URN, the agent surface and every property described", () => {
    const schema = fresh();
    expect(schema.$id).toBe(`urn:jams-engine:${kind.kind}:v1`);
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
  });

  it("reads the spec's example, and its own empty file", () => {
    expect(validateAssetDoc(kind, sample, env)).toEqual([]);
    expect(validateAssetDoc(kind, kind.empty(env, { id: "x" }), env)).toEqual([]);
  });
});

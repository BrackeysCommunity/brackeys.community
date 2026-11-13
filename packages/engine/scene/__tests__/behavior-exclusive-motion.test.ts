// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import type { EntityDef, SceneDefinition } from "../types";
import { validateScene } from "../validate";

const registry = createRegistry();

const box = ["box", 0, 0, 0.2, 0.2];
const path = {
  pts: [
    [1, 1],
    [3, 1],
  ],
  mode: "ping_pong",
  speed: 1,
};

/** Each behavior that positions its entity, with what it needs beside it. */
const POSITIONERS: Record<string, Record<string, unknown>> = {
  "character-top-down": { collider: { shape: box }, "character-top-down": {} },
  "character-side-view": { collider: { shape: box }, "character-side-view": {} },
  "nav-agent": { "nav-agent": {} },
  "path-follow": { "path-follow": { path } },
};

function scene(behaviors: Record<string, unknown>): SceneDefinition {
  const hero: EntityDef = { id: "hero", type: "marker", at: [1, 1], behaviors };
  return {
    v: 4,
    name: "positioners",
    bounds: [0, 0, 20, 20],
    settings: { physics: "rapier" },
    entities: [{ id: "floor", type: "nav", shape: ["poly", 0, 0, 10, 0, 10, 10, 0, 10] }, hero],
  };
}

const conflicts = (behaviors: Record<string, unknown>) =>
  validateScene(scene(behaviors), registry).filter((i) => i.code === "behavior-conflict");

const pairs = Object.keys(POSITIONERS).flatMap((a, i) =>
  Object.keys(POSITIONERS)
    .slice(i + 1)
    .map((b) => [a, b] as const),
);

describe("behavior-conflict between behaviors that position the entity", () => {
  it.each(Object.keys(POSITIONERS))("takes %s alone", (name) => {
    expect(validateScene(scene(POSITIONERS[name]!), registry)).toEqual([]);
  });

  it.each(pairs)("refuses %s with %s: both position the entity", (a, b) => {
    const hits = conflicts({ ...POSITIONERS[a], ...POSITIONERS[b] });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain(`"${a}"`);
    expect(hits[0]!.message).toContain(`"${b}"`);
  });

  it("still takes a positioning behavior beside a body, a player-input and a camera target", () => {
    for (const name of Object.keys(POSITIONERS)) {
      const behaviors = {
        ...POSITIONERS[name],
        "player-input": {},
        "camera-target": {},
      };
      expect(conflicts(behaviors), name).toEqual([]);
    }
  });
});

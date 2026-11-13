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
const MOVERS: Record<string, Record<string, unknown>> = {
  "character-top-down": { collider: { shape: box }, "character-top-down": {} },
  "character-side-view": { collider: { shape: box }, "character-side-view": {} },
  "nav-agent": { "nav-agent": {} },
  "path-follow": { "path-follow": { path } },
};

function scene(behaviors: Record<string, unknown>): SceneDefinition {
  const hero: EntityDef = { id: "hero", type: "marker", at: [1, 1], behaviors };
  return {
    v: 4,
    name: "movers",
    bounds: [0, 0, 20, 20],
    settings: { physics: "rapier" },
    entities: [{ id: "floor", type: "nav", shape: ["poly", 0, 0, 10, 0, 10, 10, 0, 10] }, hero],
  };
}

const conflicts = (behaviors: Record<string, unknown>) =>
  validateScene(scene(behaviors), registry).filter((i) => i.code === "behavior-conflict");

const pairs = Object.keys(MOVERS).flatMap((a, i) =>
  Object.keys(MOVERS)
    .slice(i + 1)
    .map((b) => [a, b] as const),
);

describe("behavior-conflict between movers", () => {
  it.each(Object.keys(MOVERS))("takes %s alone", (name) => {
    expect(validateScene(scene(MOVERS[name]!), registry)).toEqual([]);
  });

  it.each(pairs)("refuses %s with %s: both position the entity", (a, b) => {
    const hits = conflicts({ ...MOVERS[a], ...MOVERS[b] });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain(`"${a}"`);
    expect(hits[0]!.message).toContain(`"${b}"`);
  });

  it("still takes a mover beside a body, a player-input and a camera target", () => {
    for (const name of Object.keys(MOVERS)) {
      const behaviors = {
        ...MOVERS[name],
        "player-input": {},
        "camera-target": {},
      };
      expect(conflicts(behaviors), name).toEqual([]);
    }
  });
});

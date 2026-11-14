// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { heldInput, withHeldDoc } from "../../__tests__/fixtures/held-project";
import { testGame } from "../../__tests__/fixtures/test-game";
import { formatScene } from "../../scene/format";
import type { SceneDefinition } from "../../scene/types";
import { buildSceneVersion, sceneVersionOptions } from "../scene-version";
import { ENGINE_DIR, ENGINE_PROJECT, readHeld } from "./fixtures/scene-version/held-files";

/** The kitchen sink built with `edit` applied to std-anim, whose anim plays the kitchen animation. */
async function buildWith(edit: (behaviors: Record<string, Record<string, unknown>>) => void) {
  const held = readHeld(ENGINE_DIR);
  const def = JSON.parse(held.texts.get("kitchen-sink.json")!) as SceneDefinition;
  const anim = def.entities?.find((e) => e.id === "std-anim");
  edit(anim!.behaviors as Record<string, Record<string, unknown>>);
  const edited = withHeldDoc(held, "kitchen-sink.json", def, formatScene(def).text);
  const input = await heldInput(ENGINE_PROJECT, edited, testGame);
  return buildSceneVersion(sceneVersionOptions(input, "kitchen-sink"));
}

const errors = (result: Awaited<ReturnType<typeof buildWith>>) =>
  result.issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("buildSceneVersion judges an anim block against its animation source", () => {
  it("builds the kitchen sink as it is", async () => {
    const result = await buildWith(() => {});
    expect(errors(result)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("stops at a clip the animation lacks", async () => {
    const result = await buildWith((b) => (b.anim!.clip = "idel"));
    expect(result.ok).toBe(false);
    expect(errors(result)).toEqual(["anim-clip-unknown"]);
  });

  it("stops at a sprite drawn from an atlas without the animation's frames", async () => {
    const result = await buildWith((b) => (b.sprite = { ...b.sprite, asset: "crates" }));
    expect(result.ok).toBe(false);
    expect(errors(result)).toContain("anim-atlas-mismatch");
  });
});

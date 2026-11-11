import { resolveBindings } from "@jams/engine";
import type { ActionDef } from "@jams/engine/game";
import { describe, expect, it } from "vite-plus/test";

import { controlsHint, keyLabel } from "../controls-hint";
import { hostedGame } from "../hosted-games";

async function hosted(id: string) {
  const modules = await hostedGame(id)!.load();
  const bindings = resolveBindings({
    game: modules.game.actions,
    map: modules.project.inputMap ?? null,
  }).bindings();
  return { modules, bindings };
}

describe("controlsHint", () => {
  it("gives the platformer's hint from its bindings, in its action order", async () => {
    const { modules, bindings } = await hosted("platformer");
    expect(modules.ui).toBeNull();
    const hint = controlsHint({ actions: modules.game.actions, bindings, ownUi: false });
    expect(hint?.map((e) => [e.label, e.keys.join(" ")])).toEqual([
      ["Move left", "← A"],
      ["Move right", "→ D"],
      ["Jump", "↑ W Space"],
      ["Move down", "↓ S"],
      ["Dash", "Shift"],
      ["Grapple", "E"],
    ]);
    expect(hint?.[2]?.description).toMatch(/^Jump; release early/);
  });

  it("follows a remapped binding", async () => {
    const { modules } = await hosted("platformer");
    const bindings = resolveBindings({
      game: modules.game.actions,
      remap: { v: 1, players: { 0: { jump: [{ device: "key", code: "KeyJ" }] } } },
    }).bindings();
    const hint = controlsHint({ actions: modules.game.actions, bindings, ownUi: false });
    expect(hint?.find((e) => e.action === "jump")?.keys).toEqual(["J"]);
  });

  it("gives a game that mounts its own UI no hint", async () => {
    const { modules, bindings } = await hosted("tactics");
    expect(modules.ui).not.toBeNull();
    expect(controlsHint({ actions: modules.game.actions, bindings, ownUi: true })).toBeNull();
    // Its actions are all UI-only, so even without its UI there'd be nothing for the simulation.
    expect(controlsHint({ actions: modules.game.actions, bindings, ownUi: false })).toBeNull();
  });

  it("names four arrows or WASD as one, shows pointer buttons and skips pads and touch", () => {
    const actions: ActionDef[] = [
      {
        action: "aim",
        kind: "vector",
        description: "Aim.",
        bindings: [
          "ArrowUp",
          "ArrowLeft",
          "ArrowDown",
          "ArrowRight",
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
        ].map((code) => ({ device: "key" as const, code })),
      },
      {
        action: "fire",
        description: "Fire.",
        bindings: [
          { device: "pointer", button: "primary" },
          { device: "pad", button: "south" },
        ],
      },
      { action: "pause", description: "Pause.", bindings: [{ device: "touch", control: "menu" }] },
    ];
    const bindings = resolveBindings({ game: actions }).bindings();
    expect(controlsHint({ actions, bindings, ownUi: false })).toEqual([
      { action: "aim", label: "Aim", description: "Aim.", keys: ["Arrows", "WASD"] },
      { action: "fire", label: "Fire", description: "Fire.", keys: ["Click"] },
    ]);
  });

  it("reads key codes as keycaps", () => {
    expect(["KeyQ", "Digit3", "ControlRight", "Numpad4", "Escape", "Tab"].map(keyLabel)).toEqual([
      "Q",
      "3",
      "Ctrl",
      "Num 4",
      "Esc",
      "Tab",
    ]);
  });
});

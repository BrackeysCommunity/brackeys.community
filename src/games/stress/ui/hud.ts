import { bindText, type MountUi } from "@jams/engine";

import type { Slice } from "../types";

const sliceOf = (game: unknown) => game as Slice | null;

/**
 * The counters, a scene picker and the load knobs, each a button that sends
 * the game's command; `pause` (P, or a pad's start) toggles the pause button.
 */
export const createHud: MountUi<Slice> = (ctx) => {
  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "absolute",
    // The host's chrome over the canvas, if any, sets these; see UiContext.root.
    top: "calc(var(--jams-ui-safe-top, 0px) + 8px)",
    left: "calc(var(--jams-ui-safe-left, 0px) + 8px)",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    padding: "4px 8px",
    borderRadius: "6px",
    background: "rgba(0, 0, 0, 0.6)",
    color: "#fff",
    font: "14px system-ui, sans-serif",
    pointerEvents: "auto",
  });

  const status = document.createElement("p");
  status.setAttribute("aria-live", "off");
  status.style.margin = "0";

  const stops: (() => void)[] = [];
  const button = (label: string, press: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", press);
    stops.push(() => b.removeEventListener("click", press));
    return b;
  };

  const togglePause = () => {
    if (ctx.game.getStore().state.sim.paused) ctx.game.resume();
    else ctx.game.pause();
  };
  const pause = button("Pause", togglePause);

  const picker = document.createElement("select");
  picker.setAttribute("aria-label", "Scene");
  const pick = () => void ctx.game.send({ name: "goto", args: { scene: picker.value } });
  picker.addEventListener("change", pick);
  stops.push(() => picker.removeEventListener("change", pick));

  const crowd = (factor: number) => () => {
    const now = ctx.slice()?.crowd ?? 0;
    ctx.game.send({ name: "crowd", args: { count: Math.round(Math.max(now, 50) * factor) } });
  };
  const rate = (factor: number) => () => {
    const now = ctx.slice()?.spawnRate ?? 1;
    ctx.game.send({ name: "spawn-rate", args: { scale: now * factor } });
    ctx.game.send({ name: "spawn-cap", args: { scale: (ctx.slice()?.spawnCap ?? 1) * factor } });
  };

  panel.append(
    status,
    pause,
    picker,
    button("Crowd ÷2", crowd(0.5)),
    button("Crowd ×2", crowd(2)),
    button("Spawns ÷2", rate(0.5)),
    button("Spawns ×2", rate(2)),
  );
  ctx.root.append(panel);

  stops.push(
    bindText(
      status,
      ctx,
      (s) => sliceOf(s.game),
      (slice) =>
        slice
          ? `${slice.agents} agents · ${slice.pellets} pellets (×${slice.spawnRate}) · ${slice.enters} sensor enters`
          : "",
    ),
    bindText(
      pause,
      ctx,
      (s) => s.sim.paused,
      (paused) => (paused ? "Resume" : "Pause"),
    ),
    ctx.watch(
      (s) => sliceOf(s.game)?.scenes,
      (scenes) => {
        picker.replaceChildren(
          ...(scenes ?? []).map((scene) => {
            const option = document.createElement("option");
            option.value = option.textContent = scene;
            return option;
          }),
        );
        picker.value = ctx.slice()?.scene ?? "";
      },
    ),
    ctx.watch(
      (s) => sliceOf(s.game)?.scene,
      (scene) => void (picker.value = scene ?? ""),
    ),
    ctx.game.input.onAction(
      (e) => {
        if (e.down && !e.repeat) togglePause();
      },
      { actions: ["pause"] },
    ),
  );

  return {
    destroy() {
      for (const stop of stops) stop();
      panel.remove();
    },
  };
};

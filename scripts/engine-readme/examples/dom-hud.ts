import { bindText, bindToWorld, type GameStoreState, type MountUi } from "@jams/engine";

/** What the ferry game's `storeSlice()` returns: a new object only when something changed. */
export type FerrySlice = {
  turn: number;
  /** The boat's position, world metres. */
  boat: [x: number, y: number];
  aboard: number;
  /** Whether `cross` is among the commands the game lists as legal now. */
  canCross: boolean;
  result: "won" | null;
};

const ferry = (s: GameStoreState) => s.game as FerrySlice | null;

/**
 * The ferry's HUD, with no framework: a status line, a Cross button that
 * sends the game's `cross` command, a name tag that rides the boat, and a
 * help panel the UI-only `help` action toggles. It reads the slice and
 * changes the game only through `send`.
 */
export const mountFerryHud: MountUi<FerrySlice> = (ctx) => {
  const doc = ctx.root.ownerDocument;
  const hud = doc.createElement("div");
  hud.dataset.motion = ctx.reducedMotion ? "reduced" : "full";

  const status = doc.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const cross = doc.createElement("button");
  cross.type = "button";
  cross.textContent = "Cross";
  // The layer takes no pointer events; whatever is clickable opts back in.
  cross.style.pointerEvents = "auto";
  cross.addEventListener("click", () => ctx.game.send({ name: "cross" }));

  const tag = doc.createElement("span");
  tag.setAttribute("aria-hidden", "true");
  tag.textContent = typeof ctx.settings.boatName === "string" ? ctx.settings.boatName : "Ferry";

  const help = doc.createElement("aside");
  help.hidden = true;
  help.textContent = "Cross carries everyone aboard to the far bank.";

  hud.append(status, cross, tag, help);
  ctx.root.append(hud);

  const stops = [
    bindText(status, ctx, ferry, (f) =>
      !f
        ? "Loading the ferry"
        : f.result === "won"
          ? "Everyone is across"
          : `Turn ${f.turn} · ${f.aboard} aboard`,
    ),
    ctx.watch(ferry, (f) => {
      cross.disabled = !f?.canCross;
    }),
    bindToWorld(tag, ctx, () => {
      const f = ctx.slice();
      return f ? { x: f.boat[0], y: f.boat[1] - 0.5 } : null;
    }),
    ctx.game.input.onAction(
      (e) => {
        if (e.down && !e.repeat) help.hidden = !help.hidden;
      },
      { actions: ["help"] },
    ),
  ];

  return {
    destroy() {
      for (const stop of stops) stop();
      hud.remove();
    },
  };
};

import { createCaptions, createDialogueBox, createTextLog, type MountUi } from "@jams/engine";

/**
 * The gate game's HUD: the engine's dialogue box with portraits, a text log
 * the UI-only `log` action shows and hides, and captions for sounds and
 * voiced lines. The box draws the store's `dialogue` and sends only
 * `@dialogue-advance` and `@dialogue-choose`; all three follow the locale.
 */
export const mountTalkHud: MountUi = (ctx) => {
  const parts = [
    createDialogueBox(ctx, { speed: 40, portraits: true }),
    createTextLog(ctx, { toggle: "log", max: 50 }),
    createCaptions(ctx, { ms: 3000 }),
  ];
  return {
    destroy() {
      for (const part of parts) part.destroy();
    },
  };
};

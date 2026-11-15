import {
  createCaptions,
  createDialogueBox,
  createTextLog,
  renderRichText,
  type MountUi,
} from "@jams/engine";
import { parseRichText } from "@jams/engine/game";

/**
 * The gate game's HUD: a rich-text place name, the engine's dialogue box
 * with portraits, a text log the UI-only `log` action shows and hides, and
 * captions for sounds and voiced lines. The box draws the store's
 * `dialogue` and sends only `@dialogue-advance` and `@dialogue-choose`; all
 * three follow the locale.
 */
export const mountTalkHud: MountUi = (ctx) => {
  // The markup a text block reads, as styled spans.
  const place = ctx.root.ownerDocument.createElement("p");
  place.dataset.place = "";
  const { lines } = parseRichText("[b]North Gate[/b] [color=#ffd24a]toll road[/color]");
  renderRichText(place, lines, ctx);
  ctx.root.append(place);

  const parts = [
    { destroy: () => place.remove() },
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

import type { GameInstance } from "@jams/engine";
import { roundLength } from "@jams/engine/scene";

/**
 * A DOM hand beside the canvas: while a card is dragged the world's pointer
 * follows it, and the drop is a `play-card` command, so it is recorded and
 * replays. The host never edits the world itself.
 */
export function dealFromHand(
  game: Pick<GameInstance, "clientToWorld" | "input" | "send">,
  hand: HTMLElement,
): () => void {
  let card: string | null = null;
  const down = (e: PointerEvent) => {
    card = (e.target as HTMLElement).closest<HTMLElement>("[data-card]")?.dataset.card ?? null;
    if (card) game.input.trackPointer(true);
  };
  const up = (e: PointerEvent) => {
    if (!card) return;
    game.input.trackPointer(false);
    const at = game.clientToWorld(e.clientX, e.clientY);
    // Rounded the way a file writes metres, so the recorded args stay short.
    game.send({ name: "play-card", args: { card, at: [roundLength(at.x), roundLength(at.y)] } });
    card = null;
  };
  hand.addEventListener("pointerdown", down);
  hand.ownerDocument.addEventListener("pointerup", up);
  return () => {
    hand.removeEventListener("pointerdown", down);
    hand.ownerDocument.removeEventListener("pointerup", up);
  };
}

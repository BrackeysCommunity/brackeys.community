import type { DebugLayerFactory } from "@jams/engine/debug";
import { DEFAULT_LENGTH_UNIT } from "@jams/engine/game";
import { Container, Graphics, Text, TextStyle } from "pixi.js";

import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../entities/player";

const OUTLINE_COLOR = 0x00ffff;
const OUTLINE_ALPHA = 0.6;
/** Screen px. */
const OUTLINE_WIDTH = 2;
const DASH_LENGTH = 6;
const GAP_LENGTH = 4;

const LABEL_STYLE = new TextStyle({
  fontFamily: "monospace",
  fontSize: 10,
  fill: 0x00ffff,
});

export type PlayerScaleRef = {
  /** `scale` is canvas px per world metre: the corner reference shows the player at it, and the cursor's strokes keep their screen size. */
  update: (mouseWorldX: number, mouseWorldY: number, scale?: number) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
  worldContainer: Container;
  uiContainer: Container;
};

/** Draw a dashed rectangle outline (batched into a single stroke); `px` is one screen px in `g`'s units. */
function drawDashedRect(g: Graphics, x: number, y: number, w: number, h: number, px = 1): void {
  const sides: [number, number, number, number][] = [
    [x, y, x + w, y], // top
    [x + w, y, x + w, y + h], // right
    [x + w, y + h, x, y + h], // bottom
    [x, y + h, x, y], // left
  ];

  for (const [x1, y1, x2, y2] of sides) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / length;
    const ny = dy / length;
    let drawn = 0;

    while (drawn < length) {
      const segEnd = Math.min(drawn + DASH_LENGTH * px, length);
      g.moveTo(x1 + nx * drawn, y1 + ny * drawn);
      g.lineTo(x1 + nx * segEnd, y1 + ny * segEnd);
      drawn = segEnd + GAP_LENGTH * px;
    }
  }

  g.stroke();
}

export function createPlayerScaleRef(): PlayerScaleRef {
  // ── World-space cursor ghost ─────────────────────
  const worldCont = new Container();
  worldCont.label = "debug-player-scale-world";

  const cursorGraphics = new Graphics();
  worldCont.addChild(cursorGraphics);

  // ── UI-space corner reference ────────────────────
  const uiCont = new Container();
  uiCont.label = "debug-player-scale-ui";

  const cornerGraphics = new Graphics();
  uiCont.addChild(cornerGraphics);

  const cornerLabel = new Text({
    text: `${PLAYER_WIDTH}×${PLAYER_HEIGHT} m`,
    style: LABEL_STYLE,
  });
  cornerLabel.alpha = 0.7;
  uiCont.addChild(cornerLabel);

  let cornerScale = 0;

  // Draw the fixed corner reference (top-right area), the player as big as it shows on screen
  function drawCornerRef(scale: number): void {
    if (scale === cornerScale) return;
    cornerScale = scale;
    const margin = 16;
    const x = margin;
    const y = margin;
    const w = PLAYER_WIDTH * scale;
    const h = PLAYER_HEIGHT * scale;

    cornerGraphics.clear();
    cornerGraphics.setStrokeStyle({
      width: OUTLINE_WIDTH,
      color: OUTLINE_COLOR,
      alpha: OUTLINE_ALPHA,
    });
    drawDashedRect(cornerGraphics, x, y, w, h);

    // Dimension labels
    cornerLabel.position.set(x, y + h + 4);
  }

  drawCornerRef(DEFAULT_LENGTH_UNIT);

  // Position the UI container — caller should position in top-right
  // We'll use a fixed offset from top-right; the parent positions this
  uiCont.position.set(0, 0);

  function update(mouseWorldX: number, mouseWorldY: number, scale = DEFAULT_LENGTH_UNIT): void {
    drawCornerRef(scale);
    const px = 1 / scale;
    cursorGraphics.clear();
    cursorGraphics.setStrokeStyle({
      width: OUTLINE_WIDTH * px,
      color: OUTLINE_COLOR,
      alpha: OUTLINE_ALPHA * 0.7,
    });
    drawDashedRect(
      cursorGraphics,
      mouseWorldX - PLAYER_WIDTH / 2,
      mouseWorldY - PLAYER_HEIGHT / 2,
      PLAYER_WIDTH,
      PLAYER_HEIGHT,
      px,
    );
  }

  function setVisible(visible: boolean): void {
    worldCont.visible = visible;
    uiCont.visible = visible;
  }

  function destroy(): void {
    cursorGraphics.destroy();
    cornerGraphics.destroy();
    cornerLabel.destroy();
    worldCont.destroy();
    uiCont.destroy();
  }

  return {
    update,
    setVisible,
    destroy,
    worldContainer: worldCont,
    uiContainer: uiCont,
  };
}

/** A player-sized outline at the cursor and a size reference in the corner. */
export const playerScaleLayer: DebugLayerFactory = {
  id: "scale",
  create(host) {
    const ref = createPlayerScaleRef();
    host.worldContainer.addChild(ref.worldContainer);
    host.uiContainer.addChild(ref.uiContainer);
    const parent = host.uiContainer.parent as Container | null;
    ref.uiContainer.position.set(parent ? parent.width - 100 : 700, 0);
    return {
      update: (frame) =>
        ref.update(frame.mouseWorld.x, frame.mouseWorld.y, host.worldContainer.scale.x || 1),
      setVisible: ref.setVisible,
      destroy: ref.destroy,
    };
  },
};

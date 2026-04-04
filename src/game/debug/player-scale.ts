import { Container, Graphics, Text, TextStyle } from "pixi.js";

// Player hitbox dimensions — must match player.ts constants
const PLAYER_WIDTH = 60;
const PLAYER_HEIGHT = 60;

const OUTLINE_COLOR = 0x00ffff;
const OUTLINE_ALPHA = 0.6;
const OUTLINE_WIDTH = 2;
const DASH_LENGTH = 6;
const GAP_LENGTH = 4;

const LABEL_STYLE = new TextStyle({
  fontFamily: "monospace",
  fontSize: 10,
  fill: 0x00ffff,
});

export type PlayerScaleRef = {
  update: (mouseWorldX: number, mouseWorldY: number) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
  worldContainer: Container;
  uiContainer: Container;
};

/** Draw a dashed rectangle outline (batched into a single stroke) */
function drawDashedRect(g: Graphics, x: number, y: number, w: number, h: number): void {
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
      const segEnd = Math.min(drawn + DASH_LENGTH, length);
      g.moveTo(x1 + nx * drawn, y1 + ny * drawn);
      g.lineTo(x1 + nx * segEnd, y1 + ny * segEnd);
      drawn = segEnd + GAP_LENGTH;
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
    text: `${PLAYER_WIDTH}×${PLAYER_HEIGHT} px`,
    style: LABEL_STYLE,
  });
  cornerLabel.alpha = 0.7;
  uiCont.addChild(cornerLabel);

  // Draw the fixed corner reference (top-right area)
  function drawCornerRef(): void {
    const margin = 16;
    const x = margin;
    const y = margin;

    cornerGraphics.clear();
    cornerGraphics.setStrokeStyle({
      width: OUTLINE_WIDTH,
      color: OUTLINE_COLOR,
      alpha: OUTLINE_ALPHA,
    });
    drawDashedRect(cornerGraphics, x, y, PLAYER_WIDTH, PLAYER_HEIGHT);

    // Dimension labels
    cornerLabel.position.set(x, y + PLAYER_HEIGHT + 4);
  }

  drawCornerRef();

  // Position the UI container — caller should position in top-right
  // We'll use a fixed offset from top-right; the parent positions this
  uiCont.position.set(0, 0);

  function update(mouseWorldX: number, mouseWorldY: number): void {
    cursorGraphics.clear();
    cursorGraphics.setStrokeStyle({
      width: OUTLINE_WIDTH,
      color: OUTLINE_COLOR,
      alpha: OUTLINE_ALPHA * 0.7,
    });
    drawDashedRect(
      cursorGraphics,
      mouseWorldX - PLAYER_WIDTH / 2,
      mouseWorldY - PLAYER_HEIGHT / 2,
      PLAYER_WIDTH,
      PLAYER_HEIGHT,
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

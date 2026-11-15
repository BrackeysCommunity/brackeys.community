/**
 * The browser smoke's smooth-follow run, shared by the page, the runner and
 * their tests: a prop pushed right at constant speed under a camera that
 * follows it, played on the browser's own animation frames. Each frame the
 * stage is read back and the prop's drawn centre found on the canvas; once
 * the follow has settled, its place on screen must hold still from frame to
 * frame, however the display's rate beats against the 60 Hz tick.
 */
import { createGame, type GameInstance } from "@jams/engine";
import { defineGame } from "@jams/engine/game";
import type { RapierModule } from "@jams/engine/headless";
import type { SceneDefinition } from "@jams/engine/scene";

export const FOLLOW_HERO = "hero";

/** The hero's speed, m/s. */
export const FOLLOW_SPEED = 3;

export const FOLLOW_CANVAS = { width: 240, height: 135 } as const;

/** Black, which the hero's drawing never is: every lit pixel is the hero's. */
export const FOLLOW_BACKGROUND = 0x000000;

/** Frames the follow gets to settle before the record starts. */
export const FOLLOW_SETTLE_FRAMES = 150;

/** Frames recorded once it has settled. */
export const FOLLOW_FRAMES = 120;

/** The most the hero's on-screen x may move in one settled frame, px. */
export const FOLLOW_STEP_PX = 0.5;

/** Pushes the hero to its speed as the scene loads; nothing else of its own. */
export const followGame = defineGame({
  id: "smoke-follow",
  types: [],
  actions: [],
  createRuntime: (ctx) => ({
    onLoad() {
      ctx.bodies.setVelocity(FOLLOW_HERO, { x: FOLLOW_SPEED, y: 0 });
    },
    snapshot: () => null,
  }),
});

/** The hero alone, floating free, the camera's only target. */
export const followScene: SceneDefinition = {
  v: 4,
  name: "smoke-smooth-follow",
  game: followGame.id,
  bounds: [-200, -50, 200, 50],
  settings: { physics: "rapier", gravity: [0, 0] },
  entities: [
    {
      id: FOLLOW_HERO,
      type: "prop",
      shape: ["box", 0, 0, 0.2, 0.2],
      density: 1,
      restitution: 0,
      behaviors: { "camera-target": {} },
    },
  ],
};

/** What the page recorded: the hero's drawn x and the world origin's, canvas px, and each frame's rAF time. */
export type SmoothFollowProbe = {
  renderer: string;
  /** The hero's drawn centre on the canvas each recorded frame; null where nothing was drawn. */
  screen: (number | null)[];
  /** Where the world origin sat on the canvas each frame: how far the camera carried the world. */
  origin: number[];
  /** Each frame's `requestAnimationFrame` timestamp, ms. */
  at: number[];
};

/**
 * The lit pixels' weighted mean x on an RGBA frame, px from the left with
 * pixel centres at +0.5; null for a frame with nothing lit. Antialiased
 * edges weigh by how lit they are, so the mean moves by fractions of a pixel.
 */
export function litCentreX(
  frame: { width: number; height: number; data: ArrayLike<number> },
  background = FOLLOW_BACKGROUND,
): number | null {
  const bg = [(background >> 16) & 0xff, (background >> 8) & 0xff, background & 0xff] as const;
  let sum = 0;
  let weight = 0;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const i = (y * frame.width + x) * 4;
      const w =
        Math.max(
          Math.abs((frame.data[i] ?? 0) - bg[0]),
          Math.abs((frame.data[i + 1] ?? 0) - bg[1]),
          Math.abs((frame.data[i + 2] ?? 0) - bg[2]),
        ) / 255;
      if (w <= 0) continue;
      sum += (x + 0.5) * w;
      weight += w;
    }
  }
  return weight > 0 ? sum / weight : null;
}

/** Null when the recorded run held the bound, else why not. */
export function judgeSmoothFollow(probe: SmoothFollowProbe | undefined): string | null {
  if (!probe) return "the page recorded no smooth-follow run";
  if (probe.screen.length !== FOLLOW_FRAMES)
    return `the smooth-follow run recorded ${probe.screen.length} frames, not ${FOLLOW_FRAMES}`;
  const missing = probe.screen.findIndex((x) => x === null);
  if (missing >= 0) return `the hero wasn't drawn on recorded frame ${missing}`;
  const xs = probe.screen as number[];
  const carried = Math.abs(probe.origin.at(-1)! - probe.origin[0]!);
  const seconds = (probe.at.at(-1)! - probe.at[0]!) / 1000;
  // At 100 px per metre the world passes at 300 px/s; half that rules out a camera that didn't move.
  if (!(seconds > 0) || carried / seconds < FOLLOW_SPEED * 50)
    return `the camera carried the world ${carried.toFixed(1)} px in ${seconds.toFixed(2)} s: the hero isn't moving under it`;
  for (let i = 1; i < xs.length; i++) {
    const step = xs[i]! - xs[i - 1]!;
    if (Math.abs(step) >= FOLLOW_STEP_PX)
      return `the followed hero moved ${step.toFixed(2)} px on screen between frames ${i - 1} and ${i} (${probe.renderer})`;
  }
  return null;
}

/** `outcome` failed when the page's smooth-follow run broke the bound. */
export function judgeSmoothOutcome<
  O extends { status: "pass" | "fail" | "skipped"; reason?: string },
>(outcome: O, probe: SmoothFollowProbe | undefined): O & { smoothFollow?: SmoothFollowProbe } {
  const seen: O & { smoothFollow?: SmoothFollowProbe } = {
    ...outcome,
    ...(probe ? { smoothFollow: probe } : {}),
  };
  if (outcome.status !== "pass") return seen;
  const wrong = judgeSmoothFollow(probe);
  return wrong ? { ...seen, status: "fail", reason: wrong } : seen;
}

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** Plays the hero on a fresh canvas and records `FOLLOW_FRAMES` settled frames. */
export async function runSmoothFollow(
  loadRapier: () => Promise<RapierModule>,
): Promise<SmoothFollowProbe> {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  let game: GameInstance | null = null;
  try {
    game = await createGame(canvas, {
      game: followGame,
      rapier: loadRapier,
      scene: followScene,
      displayWidth: FOLLOW_CANVAS.width,
      displayHeight: FOLLOW_CANVAS.height,
      backgroundColor: FOLLOW_BACKGROUND,
    });
    game.start();
    if (!game.runtime()) throw new Error("the smooth-follow scene didn't load");
    for (let i = 0; i < FOLLOW_SETTLE_FRAMES; i++) await frame();
    const probe: SmoothFollowProbe = { renderer: "", screen: [], origin: [], at: [] };
    const box = canvas.getBoundingClientRect();
    for (let i = 0; i < FOLLOW_FRAMES; i++) {
      probe.at.push(await frame());
      const read = game.extractFrame();
      if (!read) throw new Error("the renderer had no frame to read back");
      probe.renderer = read.renderer;
      const x = litCentreX(read);
      probe.screen.push(x === null ? null : (x * box.width) / read.width);
      probe.origin.push(game.worldToClient({ x: 0, y: 0 }).x - box.left);
    }
    return probe;
  } finally {
    game?.destroy();
    canvas.remove();
  }
}

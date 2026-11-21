import type { PuzzleLayout, PuzzleMove } from "../src/api.ts";
import type { Point } from "../src/shell/board.ts";
import type { Family, Model, Scene, SceneHost } from "../src/shell/kit.ts";

/**
 * A scene on a surface of a known size, for gesture tests: pointer paths
 * in, the moves the scene made out. The test file needs a DOM, so it
 * starts with `// @vitest-environment happy-dom`.
 */
export interface Stage {
  surface: HTMLElement;
  scene: Scene;
  model: Model;
  /** Every move the scene made, stamped with the stage's clock. */
  moves: PuzzleMove[];
  /** Ms since the first move; set it to move time. */
  at: number;
  /** How often the scene started the clock with no move. */
  arms: number;
  down(p: Point): void;
  move(p: Point): void;
  up(p: Point): void;
  cancel(): void;
  /** Down at `from`, through a few points, up at `to`. */
  drag(from: Point, to: Point): void;
  tap(p: Point): void;
  frame(): void;
}

export interface StageOptions {
  width?: number;
  height?: number;
  compact?: boolean;
  guide?: PuzzleMove;
  pointerType?: string;
}

export function stage(family: Family, layout: PuzzleLayout, opts: StageOptions = {}): Stage {
  const { width = 360, height = 420 } = opts;
  const surface = document.createElement("div");
  surface.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      x: 0,
      y: 0,
      width,
      height,
      right: width,
      bottom: height,
      toJSON() {},
    }) as DOMRect;
  document.body.append(surface);

  const model = family.start(layout);
  const st = { at: 0, arms: 0 };
  const moves: PuzzleMove[] = [];
  const host: SceneHost = {
    surface,
    layout,
    model,
    compact: Boolean(opts.compact),
    guide: opts.guide,
    move(a, b = 0, c = 0) {
      const m = { at: st.at, a, ...(b ? { b } : {}), ...(c ? { c } : {}) };
      moves.push(m);
      model.run(st.at);
      return model.apply(m);
    },
    arm() {
      st.arms++;
    },
    now: () => st.at,
  };
  const scene = family.mount(host);
  scene.frame(0);

  const fire = (type: string, p: Point) =>
    surface.dispatchEvent(
      new PointerEvent(type, {
        clientX: p.x,
        clientY: p.y,
        pointerId: 1,
        pointerType: opts.pointerType ?? "touch",
        bubbles: true,
        cancelable: true,
      }),
    );
  const out: Stage = {
    surface,
    scene,
    model,
    moves,
    get at() {
      return st.at;
    },
    set at(ms: number) {
      st.at = ms;
    },
    get arms() {
      return st.arms;
    },
    down: (p) => fire("pointerdown", p),
    move: (p) => fire("pointermove", p),
    up: (p) => fire("pointerup", p),
    cancel: () => fire("pointercancel", { x: 0, y: 0 }),
    drag(from, to) {
      out.down(from);
      for (const t of [0.25, 0.5, 0.75, 1])
        out.move({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
      out.up(to);
      out.frame();
    },
    tap(p) {
      out.down(p);
      out.up(p);
      out.frame();
    },
    frame: () => scene.frame(st.at),
  };
  return out;
}

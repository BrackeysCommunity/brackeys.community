import type { PuzzleLayout, PuzzleMove } from "../src/api.ts";
import type { Point } from "../src/shell/board.ts";
import type { Family, Model, Scene, SceneHost } from "../src/shell/kit.ts";
import type { PartySceneHost, PartyVersion } from "../src/shell/party-registry.ts";

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
  /** How far each touch the scene reported landed from its mark, and whether it landed. */
  drops: { missPx: number; hitPx: number; landed: boolean }[];
  /** Lights a hint, as the shell does, until another or none is lit. */
  hint(m: PuzzleMove | undefined): void;
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
  /** A party seat: the scene is given a PartySceneHost and its moves carry the seat. */
  seat?: number;
  /** Seats at the machine; the layout's own count when left out. */
  seats?: number;
  /** Another stage's model, so two seats press one machine. */
  model?: Model;
  glimpse?: PuzzleLayout;
}

export interface PartyStageOptions extends StageOptions {
  seat: number;
}

function isVersion(kind: Family | PartyVersion): kind is PartyVersion {
  return "family" in kind;
}

/**
 * A family's scene, or a party version's for one seat. A party stage's
 * moves carry the seat; pass one stage's model to the next so both seats
 * press the same machine, each drawing the other's moves as relayed ones.
 */
export function stage(
  kind: Family | PartyVersion,
  layout: PuzzleLayout,
  opts: StageOptions = {},
): Stage {
  const model = opts.model ?? kind.start(layout);
  if (!isVersion(kind) && opts.seat === undefined)
    return build(layout, opts, model, undefined, (host) => kind.mount(host));
  const seat = opts.seat ?? 0;
  return build(layout, opts, model, seat, (host) => {
    const seated: PartySceneHost = {
      ...host,
      seat,
      seats: opts.seats ?? layout.seats ?? 1,
      glimpse: opts.glimpse,
    };
    return (kind as PartyVersion).mount(seated);
  });
}

export function partyStage(
  version: PartyVersion,
  layout: PuzzleLayout,
  opts: PartyStageOptions,
): Stage {
  return stage(version, layout, opts);
}

function build(
  layout: PuzzleLayout,
  opts: StageOptions,
  model: Model,
  seat: number | undefined,
  mount: (host: SceneHost) => Scene,
): Stage {
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

  const st: { at: number; arms: number; hint: PuzzleMove | undefined } = {
    at: 0,
    arms: 0,
    hint: undefined,
  };
  const moves: PuzzleMove[] = [];
  const drops: Stage["drops"] = [];
  const host: SceneHost = {
    surface,
    layout,
    model,
    compact: Boolean(opts.compact),
    guide: opts.guide,
    move(a, b = 0, c = 0) {
      const m: PuzzleMove = {
        at: st.at,
        a,
        ...(b ? { b } : {}),
        ...(c ? { c } : {}),
        ...(seat !== undefined ? { seat } : {}),
      };
      moves.push(m);
      model.run(st.at);
      return model.apply(m);
    },
    arm() {
      st.arms++;
    },
    now: () => st.at,
    hinted: () => st.hint,
    dropped: (missPx, hitPx, landed) => drops.push({ missPx, hitPx, landed }),
  };
  const scene = mount(host);
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
    drops,
    hint(m) {
      st.hint = m;
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

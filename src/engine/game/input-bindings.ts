import { closest } from "../scene/did-you-mean";
import { KEY_CODES, KEY_TO_CODE, PAD_AXES, PAD_BUTTONS, POINTER_BUTTONS } from "./input-codes";
import type { ActionKind, Binding, GameDefinition, PlayersDef, Registry } from "./types";

/** What a binding is judged against: its action's kind, the seats there are and the declared touch controls. */
export type BindingContext = {
  kind: ActionKind;
  /** Seats `0…max−1`. */
  max: number;
  /** Ids of the input map's on-screen controls; absent, a touch binding's control isn't judged. */
  controls?: readonly string[];
};

/** One thing wrong with a binding; `path` is a JSON Pointer inside the binding (`/code`). */
export type BindingProblem = {
  code: "binding-unknown" | "player-unknown";
  message: string;
  path: string;
  expected?: string;
  got?: string;
  hint?: string;
};

/** The most seats a game or an input map may declare. */
export const SEAT_LIMIT = 8;

/** One seat that every device drives. */
export const DEFAULT_PLAYERS: PlayersDef = Object.freeze({ max: 1, join: "auto" });

/** The seats a run has: the input map's `players`, else the game's, else one seat. */
export function resolvePlayers(
  map: { players?: PlayersDef } | null | undefined,
  game: GameDefinition | null | undefined,
): PlayersDef {
  return map?.players ?? game?.input?.players ?? DEFAULT_PLAYERS;
}

/** How many seats `def` allows: its `max`, floored and held to 1–`SEAT_LIMIT`. */
export function seatLimitOf(def: PlayersDef): number {
  return Math.min(SEAT_LIMIT, Math.max(1, Math.floor(def.max)));
}
const JOIN_POLICIES: readonly PlayersDef["join"][] = ["auto", "press", "host"];
const DEVICES = ["key", "pad", "pointer", "touch"] as const;
const STICKS = ["left", "right"] as const;
const TRIGGERS = ["lt", "rt"] as const;
const AXIS_NAMES: readonly string[] = [...PAD_AXES, ...TRIGGERS];
const COMPONENTS = ["x", "y"] as const;

const show = (v: unknown): string =>
  v === undefined ? "nothing" : typeof v === "string" ? `"${v}"` : JSON.stringify(v);
const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

export const ACTION_KINDS: readonly ActionKind[] = ["button", "axis", "vector"];

/**
 * An action's bindings: its `bindings`, else its 0.x layout `keys` as a key
 * binding for every code `KEY_TO_CODE` gives each key. A key the table
 * doesn't know binds nothing here; `keysProblems` refuses it where the
 * action enters.
 */
export function declaredBindings(def: {
  bindings?: readonly Binding[];
  keys?: readonly string[];
}): readonly Binding[] {
  if (def.bindings) return def.bindings;
  return (def.keys ?? []).flatMap((key) =>
    (KEY_TO_CODE[key] ?? []).map((code): Binding => ({ device: "key", code })),
  );
}

const KEY_NAMES = Object.keys(KEY_TO_CODE);

/**
 * The 0.x key that stands for `got`: a key-table spelling in any case
 * ("arrowup" is "ArrowUp"), else the key of a code it names ("space" is
 * " ", the key Space types).
 */
function keyGuess(got: string): { key: string; code?: string } | undefined {
  const key = closest(got, KEY_NAMES);
  if (key !== undefined) return { key };
  const code = KEY_CODES.find((c) => c.toLowerCase() === got.toLowerCase());
  const typed = code && KEY_NAMES.find((k) => KEY_TO_CODE[k]!.includes(code));
  return typed ? { key: typed, code } : undefined;
}

/**
 * What's wrong with an action's 0.x `keys`, read only when it has no
 * `bindings`: a key `KEY_TO_CODE` doesn't know would bind nothing, so it is
 * refused (`binding-unknown`) with a did-you-mean. The table is 0.x's
 * `KeyboardEvent.key` spelling, single characters lowercase: Space is
 * `" "`, not `"space"`. There are no aliases: `bindings` names keys by
 * `code`.
 */
export function keysProblems(def: {
  bindings?: readonly Binding[];
  keys?: readonly unknown[];
}): BindingProblem[] {
  const out: BindingProblem[] = [];
  if (def.bindings) return out;
  (def.keys ?? []).forEach((key, i) => {
    if (typeof key === "string" && Object.hasOwn(KEY_TO_CODE, key)) return;
    const guess = typeof key === "string" ? keyGuess(key) : undefined;
    const mean = guess ? `did you mean ${show(guess.key)}?` : undefined;
    out.push({
      code: "binding-unknown",
      message: `unknown 0.x key ${show(key)}${mean ? `; ${mean}` : ""}`,
      path: `/keys/${i}`,
      expected: "a US-layout KeyboardEvent.key the key table knows",
      got: show(key),
      hint: guess?.code
        ? `${mean} Or bind { "device": "key", "code": "${guess.code}" }.`
        : (mean ?? 'Bind keys by code instead: { "device": "key", "code": "KeyA" }.'),
    });
  });
  return out;
}

/** An action name no declared action has (`binding-unknown`, with a did-you-mean); null for a declared one. */
export function actionProblem(name: string, actionNames: readonly string[]): BindingProblem | null {
  if (actionNames.includes(name)) return null;
  const guess = closest(name, actionNames);
  return {
    code: "binding-unknown",
    message: `no action "${name}"${guess ? `; did you mean "${guess}"?` : ""}`,
    path: "/action",
    ...(actionNames.length > 0 ? { expected: actionNames.map((n) => `"${n}"`).join(" | ") } : {}),
    got: `"${name}"`,
    ...(guess ? { hint: `did you mean "${guess}"?` } : {}),
  };
}

/** What's wrong with a seats declaration: `max` a whole number from 1 to 8, `join` a known policy. */
export function playersProblems(players: PlayersDef): BindingProblem[] {
  const out: BindingProblem[] = [];
  const max: unknown = players.max;
  if (!(typeof max === "number" && Number.isInteger(max) && max >= 1 && max <= SEAT_LIMIT))
    out.push({
      code: "player-unknown",
      message: `players.max must be a whole number from 1 to ${SEAT_LIMIT}; got ${show(max)}`,
      path: "/max",
      expected: `1…${SEAT_LIMIT}`,
      got: show(max),
    });
  if (!JOIN_POLICIES.includes(players.join))
    out.push({
      code: "player-unknown",
      message: `unknown join policy ${show(players.join)}`,
      path: "/join",
      expected: JOIN_POLICIES.map((j) => `"${j}"`).join(" | "),
      got: show(players.join),
    });
  return out;
}

/**
 * The one check every path that accepts a binding calls: the registry, the
 * input-map kind, a rebind, the host's bindings and `scene input`. Judges
 * the device's vocabulary (a key code, a pad button, axis or stick, a
 * pointer button, a declared touch control), with a did-you-mean over the
 * code tables; whether the binding's shape fits its action's kind; and a
 * key binding's seat against `max`.
 */
export function bindingProblems(binding: Binding, ctx: BindingContext): BindingProblem[] {
  const out: BindingProblem[] = [];
  const b = binding as unknown as Record<string, unknown>;

  const unknown = (field: string, what: string, got: unknown, names: readonly string[]) => {
    const guess = typeof got === "string" ? closest(got, names) : undefined;
    out.push({
      code: "binding-unknown",
      message: `unknown ${what} ${show(got)}${guess ? `; did you mean "${guess}"?` : ""}`,
      path: `/${field}`,
      expected: names.length <= 20 ? names.map((n) => `"${n}"`).join(" | ") : what,
      got: show(got),
      ...(guess ? { hint: `did you mean "${guess}"?` } : {}),
    });
  };
  const misfit = (field: string, message: string, expected?: string) =>
    out.push({
      code: "binding-unknown",
      message,
      path: `/${field}`,
      ...(expected ? { expected } : {}),
      got: show(b[field]),
    });

  /** A key or pad button: on a button action alone; on an axis it carries a value; on a vector, an axis and a value. */
  const contribution = (what: string) => {
    if (ctx.kind === "button") {
      if (b.axis !== undefined) misfit("axis", `a ${what} on a button action takes no axis`);
      if (b.value !== undefined) misfit("value", `a ${what} on a button action takes no value`);
      return;
    }
    if (b.value !== undefined && !(typeof b.value === "number" && Math.abs(b.value) <= 1))
      misfit("value", `a ${what}'s value must be a number in −1…1`, "a number in −1…1");
    if (ctx.kind === "axis" && b.axis !== undefined)
      misfit("axis", `a ${what} on an axis action takes no axis; its value is the axis`);
    if (ctx.kind === "vector" && !(COMPONENTS as readonly unknown[]).includes(b.axis))
      misfit("axis", `a ${what} on a vector action needs axis "x" or "y"`, '"x" | "y"');
  };

  switch (b.device) {
    case "key": {
      if (typeof b.code !== "string" || !KEY_CODES.includes(b.code))
        unknown("code", "key code", b.code, KEY_CODES);
      contribution("key");
      if (b.player !== undefined) {
        if (!isIndex(b.player) || b.player >= ctx.max)
          out.push({
            code: "player-unknown",
            message: `seat ${show(b.player)} is past the last seat, ${ctx.max - 1}`,
            path: "/player",
            expected: `a whole number from 0 to ${ctx.max - 1}`,
            got: show(b.player),
          });
      }
      break;
    }
    case "pad": {
      if (b.stick !== undefined) {
        if (!(STICKS as readonly unknown[]).includes(b.stick))
          unknown("stick", "pad stick", b.stick, STICKS);
        if (ctx.kind !== "vector")
          misfit("stick", `a stick binds a vector action, not a ${ctx.kind} action`);
      } else if (b.button !== undefined) {
        if (!isIndex(b.button) && !(PAD_BUTTONS as readonly unknown[]).includes(b.button))
          unknown("button", "pad button", b.button, PAD_BUTTONS);
        contribution("pad button");
      } else if (b.axis !== undefined) {
        if (!isIndex(b.axis) && !AXIS_NAMES.includes(b.axis as string))
          unknown("axis", "pad axis", b.axis, AXIS_NAMES);
        if (ctx.kind !== "axis")
          misfit("axis", `a pad axis binds an axis action, not a ${ctx.kind} action`);
        if (b.scale !== undefined && !(typeof b.scale === "number" && Number.isFinite(b.scale)))
          misfit("scale", "a pad axis's scale must be a finite number", "a number");
      } else {
        misfit(
          "button",
          "a pad binding names a button, an axis or a stick",
          "button | axis | stick",
        );
      }
      break;
    }
    case "pointer": {
      if (!(POINTER_BUTTONS as readonly unknown[]).includes(b.button))
        unknown("button", "pointer button", b.button, POINTER_BUTTONS);
      if (ctx.kind !== "button")
        misfit("button", `a pointer button binds a button action, not a ${ctx.kind} action`);
      break;
    }
    case "touch": {
      if (typeof b.control !== "string") misfit("control", "a touch binding names a control");
      else if (ctx.controls && !ctx.controls.includes(b.control))
        unknown("control", "touch control", b.control, ctx.controls);
      break;
    }
    default:
      unknown("device", "device", b.device, DEVICES);
  }
  return out;
}

/**
 * Whether `name` is a UI-only action (`ActionDef.ui`): resolved from devices
 * and delivered to `input.onAction` listeners, but never to the simulation,
 * a recording or a fuzz macro.
 */
export function isUiAction(registry: Registry, name: string): boolean {
  return registry.uiActionNames.includes(name);
}

/** `bindings` without those of UI-only actions: what a headless input path may raise. */
export function simBindings<B extends { action: string }>(
  registry: Registry,
  bindings: readonly B[],
): B[] {
  return bindings.filter((b) => !isUiAction(registry, b.action));
}

/** The JSON Schema keyword marking the UI-only actions in an action enum. */
export const UI_ACTION_KEYWORD = "x-ui";

/**
 * `registry`'s actions as a JSON Schema enum for a file that binds them, when
 * it declares UI-only ones: the simulation's in one branch, the UI-only ones
 * in another marked `x-ui: true`. Null when it declares no UI-only action.
 */
export function uiActionEnumJson(registry: Registry): Record<string, unknown> | null {
  const names = registry.actionNames;
  const ui = names.filter((n) => isUiAction(registry, n));
  if (ui.length === 0) return null;
  const sim = names.filter((n) => !isUiAction(registry, n));
  const uiBranch = { enum: ui, [UI_ACTION_KEYWORD]: true };
  return { anyOf: sim.length > 0 ? [{ enum: sim }, uiBranch] : [uiBranch] };
}

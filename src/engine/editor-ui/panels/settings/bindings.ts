import { bindingProblems, declaredBindings } from "../../../game/input-bindings";
import type { ActionDef, ActionKind, Binding, Registry } from "../../../game/types";
import type { InputMapFile } from "../../../project/index";
import { isPlainObject } from "../../../project/kinds/define";

/** One of the game's actions as the Input tab lists it. */
export type ActionRow = {
  action: string;
  kind: ActionKind;
  description: string;
  /** UI-only: read by the game's UI, never by the simulation or a recording. */
  ui: boolean;
  /** The bindings in effect: the input map's for the action, else the game's. */
  bindings: readonly Binding[];
  /** The input map lists the action, so its bindings replace the game's. */
  mapped: boolean;
};

type MapAction = NonNullable<InputMapFile["actions"]>[number];

/** The input map's action entries, read leniently from its doc value. */
export function mapActions(value: Record<string, unknown> | null): MapAction[] {
  const raw = value?.actions;
  return Array.isArray(raw)
    ? raw.filter(
        (a): a is MapAction =>
          isPlainObject(a) && typeof a.action === "string" && Array.isArray(a.bindings),
      )
    : [];
}

/** Every action the game declares, with the bindings the map gives it, else the game's. */
export function actionRows(registry: Registry, value: Record<string, unknown> | null): ActionRow[] {
  const mapped = new Map(mapActions(value).map((a) => [a.action, a]));
  return registry.actions.map((def: ActionDef) => {
    const entry = mapped.get(def.action);
    return {
      action: def.action,
      kind: def.kind ?? "button",
      description: def.description,
      ui: def.ui === true,
      bindings: entry ? entry.bindings : declaredBindings(def),
      mapped: entry !== undefined,
    };
  });
}

const sameBinding = (a: Binding, b: Binding) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The input map's `actions` once `action` binds `bindings`: its entry's
 * bindings replaced, or a new entry at the end for an action it didn't list.
 */
export function withBindings(
  value: Record<string, unknown> | null,
  action: string,
  bindings: readonly Binding[],
): MapAction[] {
  const actions = Array.isArray(value?.actions) ? (value.actions as MapAction[]) : [];
  const at = actions.findIndex((a) => isPlainObject(a) && a.action === action);
  if (at < 0) return [...actions, { action, bindings: [...bindings] }];
  return actions.map((a, i) => (i === at ? { ...a, bindings: [...bindings] } : a));
}

/**
 * Why `binding` can't be added to `row`: a duplicate, or what the input
 * map's own check (`bindingProblems`) refuses for the action's kind, seats
 * and touch controls. Null when it can.
 */
export function addBindingProblem(
  row: ActionRow,
  binding: Binding,
  ctx: { max: number; controls: readonly string[] },
): string | null {
  if (row.bindings.some((b) => sameBinding(b, binding))) return `${row.action} already has it.`;
  const problem = bindingProblems(binding, {
    kind: row.kind,
    max: ctx.max,
    controls: ctx.controls,
  });
  return problem[0]?.message ?? null;
}

/** For an axis or vector action: which way a captured key or button pushes it. */
export type BindingDirection = { label: string; axis: "x" | "y"; value: number };

export const DIRECTIONS: Readonly<Record<"axis" | "vector", readonly BindingDirection[]>> = {
  axis: [
    { label: "−", axis: "x", value: -1 },
    { label: "+", axis: "x", value: 1 },
  ],
  vector: [
    { label: "←", axis: "x", value: -1 },
    { label: "→", axis: "x", value: 1 },
    { label: "↑", axis: "y", value: -1 },
    { label: "↓", axis: "y", value: 1 },
  ],
};

/** A captured key or pad button pointed `direction`; an axis action's binding names no axis. */
export function directed(
  binding: Binding,
  kind: ActionKind,
  direction: BindingDirection | undefined,
): Binding {
  if (!direction || kind === "button") return binding;
  if (binding.device !== "key" && !(binding.device === "pad" && "button" in binding))
    return binding;
  return kind === "axis"
    ? { ...binding, value: direction.value }
    : { ...binding, axis: direction.axis, value: direction.value };
}

const KEYCAPS: Readonly<Record<string, string>> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Space: "Space",
  Enter: "Enter",
};

const POINTER: Readonly<Record<string, string>> = {
  primary: "Click",
  secondary: "Right-click",
  middle: "Middle-click",
};

function keycap(code: string): string {
  const named = KEYCAPS[code];
  if (named) return named;
  const short = /^(?:Key|Digit)(.)$/.exec(code);
  return short ? short[1]! : code;
}

const SIGN = (value: number | undefined) => ((value ?? 1) < 0 ? "−" : "+");

/** What a binding reads as on its chip: `W`, `Pad south`, `Left stick`, `Click`, with its direction and seat. */
export function bindingLabel(binding: Binding): string {
  let label: string;
  let push: string | null = null;
  switch (binding.device) {
    case "key":
      label = keycap(binding.code);
      if (binding.axis !== undefined || binding.value !== undefined)
        push = `${binding.axis ?? ""}${SIGN(binding.value)}`;
      break;
    case "pad":
      if ("stick" in binding) label = `${binding.stick === "left" ? "Left" : "Right"} stick`;
      else if ("button" in binding) {
        label = `Pad ${binding.button}`;
        if (binding.axis !== undefined || binding.value !== undefined)
          push = `${binding.axis ?? ""}${SIGN(binding.value)}`;
      } else label = `Pad ${binding.axis}${(binding.scale ?? 1) < 0 ? " inverted" : ""}`;
      break;
    case "pointer":
      label = POINTER[binding.button] ?? `Pointer ${binding.button}`;
      break;
    case "touch":
      label = `Touch ${binding.control}`;
      break;
  }
  const seat = binding.device === "key" && binding.player !== undefined ? binding.player : null;
  return [label, push ? `(${push})` : null, seat !== null ? `P${seat + 1}` : null]
    .filter(Boolean)
    .join(" ");
}

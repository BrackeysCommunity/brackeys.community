/**
 * Scripts: a behavior with one instance per entity, written as a class
 * (`Script`) or as a function returning its hooks (`defineScript`). Both
 * give an ordinary `BehaviorDef` over one generated system, so scenes, the
 * inspector and validation see nothing new. Value imports stay inside
 * `game/` and `scene/`: the canvas-sync image carries this file.
 */
import type { z } from "zod";

import type { FLOW_LOADER, FlowLoader } from "../runtime/flow";
import type {
  CONTACT_END,
  CONTACT_START,
  SENSOR_ENTER,
  SENSOR_EXIT,
  StepEvent,
} from "../runtime/types";
import type {
  BehaviorBlock,
  BehaviorDef,
  BehaviorName,
  BehaviorSystem,
  BehaviorSystemFactory,
  RegisteredBehavior,
} from "./behaviors";
import type { BehaviorKey, Entity } from "./entity";
import { inputFor, type SeatInput } from "./input-for";
import {
  EngineError,
  scopedRef,
  type CoroutineYield,
  type Delay,
  type EngineContext,
  type JsonValue,
  type TimerAction,
} from "./types";

/** A script's definition: a behavior's, without the system the script generates or a handle type. */
export type ScriptDef<F extends z.ZodRawShape> = Omit<BehaviorDef<F>, "system" | "handle">;

/** What a script reaches: a class's `this`, a function script's `self`. */
export type ScriptSelf<F extends z.ZodRawShape = z.ZodRawShape> = {
  readonly entity: Entity;
  readonly fields: Readonly<z.infer<z.ZodObject<F>>>;
  readonly ctx: EngineContext;
  /** The entity's seat, as `inputFor(ctx, id)`. */
  readonly input: SeatInput;
  /** A `refField` of this script, resolved through `scopedRef`. */
  ref(field: string): Entity | undefined;
  /**
   * Timers and coroutines owned by the entity. A pending function action
   * or coroutine keeps a world save from being taken; the emit form
   * (`{ emit }`, about this entity unless it names one) saves.
   */
  after(delay: Delay, action: TimerAction): number;
  every(period: Delay, action: TimerAction, times?: number): number;
  run(co: () => Generator<CoroutineYield, void, void>): number;
  cancel(timer: number): void;
  /** Raises a step event about this entity. */
  emit(type: string, data?: JsonValue): void;
};

/** A script's hooks, by the names a class defines as methods and `create` returns. */
export type ScriptHooks<F extends z.ZodRawShape = z.ZodRawShape> = {
  /** At attach, once the instance exists. */
  awake?(): void;
  /** Once, after the load's or the spawn's entities attached; for a disabled entity, at its first enable. */
  start?(): void;
  /** Each tick, before physics. */
  beforeStep?(dtMs: number): void;
  beforePhysics?(): void;
  /** Each tick, after physics. */
  step?(dtMs: number): void;
  /** Each rendered frame; a `visualOnly` script's only hook. */
  render?(alpha: number): void;
  onEnable?(): void;
  onDisable?(): void;
  onDestroy?(): void;
  /** A contact this entity's watch raised: `other` is what it touched. */
  onContactStart?(other: Entity, e: StepEvent): void;
  onContactEnd?(other: Entity, e: StepEvent): void;
  /** On either side of a sensor event: `other` is the side that isn't this entity. */
  onSensorEnter?(other: Entity, e: StepEvent): void;
  onSensorExit?(other: Entity, e: StepEvent): void;
  /** The block changed in an edit; without it the instance is built again. */
  onFieldsChanged?(prev: Readonly<z.infer<z.ZodObject<F>>>): void;
  /** What a world save keeps of the instance; undefined for nothing. */
  save?(): JsonValue | undefined;
  restore?(state: JsonValue): void;
};

/** The base class `Script(def)` returns, and every class that extends it. */
export interface ScriptClass<F extends z.ZodRawShape = z.ZodRawShape> {
  new (): ScriptSelf<F> & ScriptHooks<F>;
  /** This class's `BehaviorDef`: what `defineGame`'s `behaviors` registers. */
  readonly behavior: BehaviorDef<F>;
}

const isScriptClass = (key: BehaviorKey): key is ScriptClass => typeof key === "function";

/** The definition a script class registers, or the definition itself. */
export function definitionOf(key: BehaviorKey): BehaviorDef {
  return isScriptClass(key) ? key.behavior : key;
}

/** The behavior name a definition, a script class or a name stands for. */
export function behaviorNameOf(key: BehaviorKey | BehaviorName): BehaviorName {
  return typeof key === "string" ? key : definitionOf(key).name;
}

// The event types, pinned to the runtime's constants by type: `runtime/` is type-only here.
const CONTACT_STARTED: typeof CONTACT_START = "contact:start";
const CONTACT_ENDED: typeof CONTACT_END = "contact:end";
const SENSOR_ENTERED: typeof SENSOR_ENTER = "sensor:enter";
const SENSOR_EXITED: typeof SENSOR_EXIT = "sensor:exit";
/** The key a scene runtime's context keeps its flow loader under (a `Symbol.for`, so it needn't be imported). */
const FLOW_LOADER_KEY = Symbol.for("@jams/engine:flow-loader") as typeof FLOW_LOADER;

const TICK_HOOKS = ["beforeStep", "beforePhysics", "step"] as const;
type TickHook = (typeof TICK_HOOKS)[number];
type RunHook = TickHook | "render";

type Hooks = ScriptHooks & object;

/** One instance's link to its entity: what `this` / `self` read. */
type Binding = {
  readonly id: string;
  readonly ctx: EngineContext;
  readonly def: RegisteredBehavior;
  fields: BehaviorBlock;
  entity: Entity | undefined;
  /** Replaced or detached: its function timers and coroutines stop. */
  dead: boolean;
};

const BOUND = Symbol("script binding");
/** The binding the next constructed script instance takes; set only around `new`. */
let building: Binding | undefined;

const bindingOf = (self: object): Binding => (self as { [BOUND]: Binding })[BOUND];

/** The members `ScriptSelf` names, read from the instance's binding: a class's base, a function's `self`. */
class ScriptMembers {
  constructor() {
    if (!building)
      throw new Error(
        "a script is built by its behavior's system: register the class in defineGame's behaviors and give an entity its block",
      );
    Object.defineProperty(this, BOUND, { value: building });
    building = undefined;
  }
  get entity(): Entity {
    const b = bindingOf(this);
    b.entity ??= b.ctx.entity(b.id);
    if (!b.entity)
      throw new EngineError("entity-gone", `script "${b.def.name}": "${b.id}" isn't live`, b.id);
    return b.entity;
  }
  get fields(): BehaviorBlock {
    return bindingOf(this).fields;
  }
  get ctx(): EngineContext {
    return bindingOf(this).ctx;
  }
  get input(): SeatInput {
    const b = bindingOf(this);
    return inputFor(b.ctx, b.id);
  }
  ref(field: string): Entity | undefined {
    const b = bindingOf(this);
    if (!(field in b.def.shape))
      throw new Error(`script "${b.def.name}" has no field "${field}" to resolve`);
    const value = b.fields[field];
    if (typeof value !== "string") return undefined;
    return b.ctx.entity(scopedRef(b.id, value, b.ctx.exists));
  }
  after(delay: Delay, action: TimerAction): number {
    const b = bindingOf(this);
    return b.ctx.timers.after(delay, owned(b, action), { owner: b.id });
  }
  every(period: Delay, action: TimerAction, times?: number): number {
    const b = bindingOf(this);
    return b.ctx.timers.every(period, owned(b, action), {
      owner: b.id,
      ...(times !== undefined ? { times } : {}),
    });
  }
  run(co: () => Generator<CoroutineYield, void, void>): number {
    const b = bindingOf(this);
    return b.ctx.timers.start(() => whileAlive(b, co), { owner: b.id });
  }
  cancel(timer: number): void {
    bindingOf(this).ctx.timers.cancel(timer);
  }
  emit(type: string, data?: JsonValue): void {
    const { ctx, id } = bindingOf(this);
    const pose = ctx.poses.get(id);
    ctx.emit({
      type,
      entityId: id,
      at: pose ? { x: pose.x, y: pose.y } : { x: 0, y: 0 },
      ...(data !== undefined ? { data } : {}),
    });
  }
}

/** A timer action that does nothing once its instance is replaced; the emit form names the entity unless it names one. */
function owned(b: Binding, action: TimerAction): TimerAction {
  if (typeof action === "function")
    return () => {
      if (!b.dead) action();
    };
  return action.entityId === undefined ? { ...action, entityId: b.id } : action;
}

function* whileAlive(
  b: Binding,
  co: () => Generator<CoroutineYield, void, void>,
): Generator<CoroutineYield, void, void> {
  const it = co();
  while (!b.dead) {
    const next = it.next();
    if (next.done) return;
    yield next.value;
  }
  it.return();
}

const has = (hooks: object, name: keyof ScriptHooks): boolean =>
  typeof (hooks as Record<string, unknown>)[name] === "function";

/**
 * Why a script's hooks can't run under its definition: `render` without
 * `visualOnly`, or a tick hook on a `visualOnly` script. Undefined when fine.
 */
function hooksProblem(def: Pick<BehaviorDef, "name" | "visualOnly">, hooks: object) {
  if (def.visualOnly) {
    const ticking = TICK_HOOKS.find((h) => has(hooks, h));
    if (ticking)
      return `script "${def.name}" is visualOnly, so it gets render and no tick hooks: it defines ${ticking}`;
  } else if (has(hooks, "render"))
    return `script "${def.name}" defines render but isn't visualOnly: render can only draw, so set visualOnly or do the work in step`;
  return undefined;
}

const SCRIPT_CHECK = Symbol("script check");
type Checked = { [SCRIPT_CHECK]?: () => string | undefined };

/**
 * Why a registry can't take `def`: a script class's hooks against its
 * `visualOnly` (a function script's hooks exist only once `create` runs,
 * so its attach refuses instead). Undefined for anything else.
 */
export function scriptProblem(def: BehaviorDef): string | undefined {
  return (def as Checked)[SCRIPT_CHECK]?.();
}

function withCheck<D extends BehaviorDef>(def: D, check: () => string | undefined): D {
  Object.defineProperty(def, SCRIPT_CHECK, { value: check });
  return def;
}

/** The hooks a contact or sensor event calls, on each side of the pair. */
type EventHook = "onContactStart" | "onContactEnd" | "onSensorEnter" | "onSensorExit";

type Instance = {
  readonly id: string;
  binding: Binding;
  target: Hooks;
  /** The first tick its tick hooks run on: an instance made inside a step waits for the next. */
  firstTick: number;
  on: boolean;
  awoken: boolean;
  started: boolean;
  unwatch: (() => void) | null;
};

/**
 * The one system behind both forms: instances by entity id in attach
 * order, built by `make` (a class's `new`, or `create`).
 */
function scriptSystem(make: (b: Binding) => Hooks): BehaviorSystemFactory {
  return (ctx, def): BehaviorSystem => {
    const instances = new Map<string, Instance>();
    const running: Record<RunHook, number> = {
      beforeStep: 0,
      beforePhysics: 0,
      step: 0,
      render: 0,
    };
    let listening: (() => void) | null = null;
    let warned = false;

    const stepping = () =>
      (ctx as { [FLOW_LOADER_KEY]?: FlowLoader })[FLOW_LOADER_KEY]?.stepping() ?? false;

    function build(id: string, fields: BehaviorBlock): { binding: Binding; target: Hooks } {
      const binding: Binding = { id, ctx, def, fields, entity: undefined, dead: false };
      const target = make(binding);
      const problem = hooksProblem(def, target);
      if (problem) throw new Error(problem);
      return { binding, target };
    }

    function count(target: Hooks, by: 1 | -1): void {
      for (const hook of def.visualOnly ? (["render"] as const) : TICK_HOOKS)
        if (has(target, hook)) running[hook] += by;
    }

    function wire(inst: Instance): void {
      const { target } = inst;
      if (has(target, "onContactStart") || has(target, "onContactEnd"))
        inst.unwatch = ctx.contacts.watch(inst.id);
      if (
        !listening &&
        (inst.unwatch || has(target, "onSensorEnter") || has(target, "onSensorExit"))
      )
        listening = listen();
    }

    function unwire(inst: Instance): void {
      inst.unwatch?.();
      inst.unwatch = null;
    }

    function listen(): () => void {
      const bothSides = (hook: EventHook) => (e: StepEvent) => {
        deliver(e.entityId, e.other, e, hook);
        deliver(e.other, e.entityId, e, hook);
      };
      const offs = [
        ctx.events.on(CONTACT_STARTED, bothSides("onContactStart")),
        ctx.events.on(CONTACT_ENDED, bothSides("onContactEnd")),
        ctx.events.on(SENSOR_ENTERED, bothSides("onSensorEnter")),
        ctx.events.on(SENSOR_EXITED, bothSides("onSensorExit")),
      ];
      return () => {
        for (const off of offs) off();
      };
    }

    function deliver(
      to: string | undefined,
      from: string | undefined,
      e: StepEvent,
      hook: EventHook,
    ): void {
      if (to === undefined || from === undefined) return;
      const inst = instances.get(to);
      if (!inst?.on || !inst.awoken) return;
      if (hook.startsWith("onContact") && !inst.unwatch) return;
      const fn = inst.target[hook];
      if (!fn) return;
      const other = ctx.entity(from);
      if (other) fn.call(inst.target, other, e);
    }

    function run(hook: RunHook, arg: number): void {
      const tick = ctx.tick;
      for (const inst of instances.values()) {
        if (!inst.on || (hook !== "render" && inst.firstTick > tick)) continue;
        inst.target[hook]?.(arg);
      }
    }

    function begin(inst: Instance): void {
      if (inst.started || !inst.on) return;
      inst.started = true;
      inst.target.start?.();
    }

    function end(inst: Instance): void {
      inst.binding.dead = true;
      unwire(inst);
      count(inst.target, -1);
    }

    function replace(inst: Instance, fields: BehaviorBlock): void {
      inst.target.onDestroy?.();
      end(inst);
      const made = build(inst.id, fields);
      inst.binding = made.binding;
      inst.target = made.target;
      inst.firstTick = ctx.tick + (stepping() ? 1 : 0);
      count(inst.target, 1);
      wire(inst);
      inst.target.awake?.();
      if (inst.started) {
        inst.started = false;
        begin(inst);
      }
    }

    const runBeforeStep = (dtMs: number) => run("beforeStep", dtMs);
    const runBeforePhysics = () => run("beforePhysics", 0);
    const runStep = (dtMs: number) => run("step", dtMs);
    const runRender = (alpha: number) => run("render", alpha);

    const system: BehaviorSystem = {
      attach(id, block) {
        if (instances.has(id)) system.detach(id);
        const { binding, target } = build(id, block);
        const inst: Instance = {
          id,
          binding,
          target,
          firstTick: ctx.tick + (stepping() ? 1 : 0),
          on: true,
          awoken: false,
          started: false,
          unwatch: null,
        };
        instances.set(id, inst);
        count(target, 1);
        wire(inst);
        target.awake?.();
        inst.awoken = true;
      },
      detach(id) {
        const inst = instances.get(id);
        if (!inst) return;
        if (inst.awoken) inst.target.onDestroy?.();
        end(inst);
        instances.delete(id);
      },
      update(id, block, prev) {
        const inst = instances.get(id);
        if (!inst) return false;
        inst.binding.fields = block;
        if (inst.target.onFieldsChanged) {
          inst.target.onFieldsChanged(prev);
          return false;
        }
        replace(inst, block);
        // A new instance is a new handle: the host asks for it again.
        return true;
      },
      ready(ids) {
        for (const id of ids) {
          const inst = instances.get(id);
          if (inst) begin(inst);
        }
      },
      disable(id) {
        const inst = instances.get(id);
        if (!inst?.on) return;
        inst.on = false;
        inst.target.onDisable?.();
      },
      enable(id) {
        const inst = instances.get(id);
        if (!inst || inst.on) return;
        inst.on = true;
        inst.target.onEnable?.();
        begin(inst);
      },
      save(id) {
        const inst = instances.get(id);
        if (!inst) return undefined;
        if (inst.target.save) return inst.target.save();
        if (ctx.dev && !warned && inst.target instanceof ScriptMembers) {
          const props = Object.keys(inst.target);
          if (props.length > 0) {
            warned = true;
            console.warn(
              `[script] "${def.name}" has instance properties (${props.join(", ")}) and no save(): a world save keeps none of them, and a restore starts them over`,
            );
          }
        }
        return undefined;
      },
      restore(id, state) {
        instances.get(id)?.target.restore?.(state);
      },
      handle: (id) => instances.get(id)?.target,
      clear() {
        for (const inst of instances.values()) inst.binding.dead = true;
        instances.clear();
        for (const hook of Object.keys(running) as RunHook[]) running[hook] = 0;
        listening?.();
        listening = null;
      },
      size: () => instances.size,
    };
    // A script without a hook leaves it off the system, so the host skips it each tick.
    Object.defineProperties(system, {
      beforeStep: { get: () => (running.beforeStep > 0 ? runBeforeStep : undefined) },
      beforePhysics: { get: () => (running.beforePhysics > 0 ? runBeforePhysics : undefined) },
      step: { get: () => (running.step > 0 ? runStep : undefined) },
      render: { get: () => (running.render > 0 ? runRender : undefined) },
    });
    return system;
  };
}

/** The class form: `class Thruster extends Script({ … }) { … }`. `Thruster.behavior` is its `BehaviorDef`. */
export function Script<F extends z.ZodRawShape>(def: ScriptDef<F>): ScriptClass<F> {
  const made = new WeakMap<object, BehaviorDef<F>>();
  class ScriptBase extends ScriptMembers {
    static get behavior(): BehaviorDef<F> {
      const Cls = this as unknown as new () => Hooks;
      let behavior = made.get(Cls);
      if (!behavior) {
        const system = scriptSystem((b) => {
          building = b;
          try {
            return new Cls();
          } finally {
            building = undefined;
          }
        });
        behavior = withCheck({ ...def, system }, () => hooksProblem(def, Cls.prototype));
        made.set(Cls, behavior);
      }
      return behavior;
    }
  }
  return ScriptBase as unknown as ScriptClass<F>;
}

/** The function form. Returns a `BehaviorDef` whose handle is what `create` returned. */
export function defineScript<F extends z.ZodRawShape, H extends ScriptHooks<F> & object>(
  def: ScriptDef<F> & { create(self: ScriptSelf<F>): H },
): BehaviorDef<F, H & Pick<ScriptSelf<F>, "entity" | "fields">> {
  const system = scriptSystem((b) => {
    building = b;
    let self: ScriptMembers;
    try {
      self = new ScriptMembers();
    } finally {
      building = undefined;
    }
    const hooks: Hooks = def.create(self as unknown as ScriptSelf<F>);
    for (const key of ["entity", "fields"] as const) {
      if (!Object.prototype.hasOwnProperty.call(hooks, key))
        Object.defineProperty(hooks, key, { get: () => self[key], enumerable: false });
    }
    return hooks;
  });
  return { ...def, system } as BehaviorDef<F, H & Pick<ScriptSelf<F>, "entity" | "fields">>;
}

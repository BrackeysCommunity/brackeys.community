import {
  flowIssue,
  type FlowRequest,
  type FlowUse,
  type LibraryScene,
  type SceneLibrary,
  type SublevelInfo,
  type SublevelOptions,
  type SublevelResult,
} from "../game/flow";
import { sublevelId } from "../game/runtime-ids";
import { EngineError, type EngineContext, type JsonValue, type Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import type { PlayOptions } from "../headless/playtest-types";
import type { AssetId } from "../project/types";
import { expandScene } from "../scene/expand";
import { makeIssue } from "../scene/issues";
import { valueAtPath } from "../scene/resolve";
import { geometryFields } from "../scene/schema";
import { translateShape } from "../scene/shape-geometry";
import type {
  Bounds,
  ExpandedScene,
  PathDef,
  Pt,
  RuntimeEntity,
  SceneIssue,
  ShapeObj,
} from "../scene/types";
import { roundLength } from "../scene/units";
import { sublevelIssue } from "../scene/validate";
import type { LoadReport, SceneRuntimeHandle, SceneRuntimeOptions } from "./types";

/**
 * The key under which a scene runtime's context carries its flow loader,
 * kept off the public `EngineContext` type.
 */
export const FLOW_LOADER: unique symbol = Symbol.for("@jams/engine:flow-loader");

/** Which listed scene a load is, and the library its run keeps. */
export type FlowIdentity = { scene: AssetId; entry: string | null; library: SceneLibrary };

/** What `loadListed` reaches inside a runtime. */
export type FlowLoader = {
  /** The runtime's `scenes` option read now, frozen; null without one. */
  read(): SceneLibrary | null;
  /** The library the loaded scene's run keeps, read at its load; null without one. */
  current(): SceneLibrary | null;
  /** Whether a step is running, when no load may happen. */
  stepping(): boolean;
  load(scene: ExpandedScene, play: PlayOptions | undefined, flow: FlowIdentity): LoadReport;
};

type FlowCarrier = { [FLOW_LOADER]?: FlowLoader };

export function flowLoaderOf(ctx: EngineContext): FlowLoader | undefined {
  return (ctx as EngineContext & FlowCarrier)[FLOW_LOADER];
}

/**
 * A runtime's `scenes` option read once, as one load's run keeps it: the
 * list and the map copied and frozen, so the host changing its own later
 * doesn't reach the run.
 */
export function readSceneLibrary(option: SceneRuntimeOptions["scenes"]): SceneLibrary | null {
  const lib = typeof option === "function" ? option() : option;
  if (!lib) return null;
  return Object.freeze({
    list: Object.freeze(lib.list.map((e) => Object.freeze({ ...e }))),
    scenes: new Map<AssetId, LibraryScene>(lib.scenes),
  });
}

/** How a load from the library went; a refusal names the issue, and the load's report when the load itself failed. */
export type ListedLoadResult =
  | { ok: true; scene: AssetId; report: Extract<LoadReport, { ok: true }> }
  | { ok: false; issue: SceneIssue; report?: Extract<LoadReport, { ok: false }> };

export type ListedLoadOptions = {
  /** What the next scene reads as `ctx.flow.entry`. */
  entry?: string | null;
  /** Replaces the persistent value before the load. */
  persist?: JsonValue;
  play?: PlayOptions;
};

/**
 * Expands the listed scene `id` with its prefabs, judged by `flowIssue` as
 * `use` (default a `go` target: an unlisted scene or a sublevel is
 * `scene-unlisted`); a listed scene the library holds no text for is
 * `asset-missing`.
 */
export function expandListed(
  library: SceneLibrary,
  id: AssetId,
  ctx: Pick<EngineContext, "registry" | "project">,
  use: Exclude<FlowUse, "start"> = "go",
): { ok: true; scene: ExpandedScene } | { ok: false; issue: SceneIssue } {
  const refused = flowIssue(library.list, id, use);
  if (refused) return { ok: false, issue: refused };
  const listed = library.scenes.get(id);
  if (!listed) {
    return {
      ok: false,
      issue: makeIssue("asset-missing", {
        message: `"${id}" is in the scene list, but the host holds no scene for it`,
        entityIds: [id],
      }),
    };
  }
  try {
    const engine = ctx.project?.engine;
    return {
      ok: true,
      scene: expandScene(listed.def, ctx.registry, {
        prefabs: listed.prefabs,
        ...(engine ? { engine } : {}),
      }),
    };
  } catch (err) {
    return {
      ok: false,
      issue: makeIssue("schema", {
        message: `"${id}" can't be expanded: ${err instanceof Error ? err.message : String(err)}`,
        entityIds: [id],
      }),
    };
  }
}

/** The issue for a listed scene whose load the runtime refused. */
export function loadRefusalIssue(
  id: AssetId,
  report: Extract<LoadReport, { ok: false }>,
): SceneIssue {
  const entityIds = report.entityId ? [report.entityId] : [id];
  const message = `"${id}" failed to load: ${report.error}`;
  return report.reason === "physics-required" || report.reason === "physics-not-loaded"
    ? makeIssue("physics-required", { message, entityIds })
    : makeIssue("schema", { message, entityIds });
}

/**
 * Loads the listed scene `id` into `runtime` from the library its `scenes`
 * option gives now, which the new run keeps. `persist` replaces the
 * persistent value first, so the next scene's `onLoad` reads it, and goes
 * back if the load is refused; the scene's `ctx.flow.scene` is `id` and its
 * `ctx.flow.entry` is `entry`. Hosts call it between ticks, after the tick
 * that made a request ended (its destroy flush done).
 */
export function loadListed(
  runtime: SceneRuntimeHandle,
  id: AssetId,
  opts: ListedLoadOptions = {},
): ListedLoadResult {
  const loader = flowLoaderOf(runtime.ctx);
  if (!loader) throw new Error("loadListed needs a runtime built by createSceneRuntime");
  if (loader.stepping()) throw new Error("loadListed runs between ticks, never inside a step");
  const library = loader.read();
  if (!library) {
    return {
      ok: false,
      issue: makeIssue("scene-unlisted", {
        severity: "error",
        message: `"${id}" can't load through flow: this runtime has no scene list`,
        entityIds: [id],
      }),
    };
  }
  const expanded = expandListed(library, id, runtime.ctx);
  if (!expanded.ok) return expanded;

  const persist = runtime.ctx.persist;
  const replacing = opts.persist !== undefined;
  const before = replacing ? persist.value : null;
  if (opts.persist !== undefined) persist.set(opts.persist);
  const report = loader.load(expanded.scene, opts.play, {
    scene: id,
    entry: opts.entry ?? null,
    library,
  });
  if (!report.ok) {
    if (replacing) persist.set(before);
    return { ok: false, issue: loadRefusalIssue(id, report), report };
  }
  return { ok: true, scene: id, report };
}

/** Applies a drained flow request: `loadListed` with its target, entry and persist. */
export function applyFlowRequest(
  runtime: SceneRuntimeHandle,
  req: FlowRequest,
  play?: PlayOptions,
): ListedLoadResult {
  return loadListed(runtime, req.to, {
    ...(req.entry !== undefined ? { entry: req.entry } : {}),
    ...(req.persist !== undefined ? { persist: req.persist } : {}),
    ...(play ? { play } : {}),
  });
}

/** What a runtime gives its sublevels: the run's library and main scene, and the lifecycle's seams. */
export type SublevelHost = {
  ctx: EngineContext;
  registry: Registry;
  /** The scene library the loaded scene's run keeps. */
  library(): SceneLibrary | null;
  /** The loaded main scene, as it loaded. */
  main(): ExpandedScene | null;
  /** Whether any live entity carries the label's prefix (a detach not yet flushed). */
  holds(label: string): boolean;
  place(entities: readonly RuntimeEntity[]): void;
  destroy(label: string): void;
  /** The attached sublevels' bounds, world metres, in attach order; called after every attach and detach. */
  bounds(rects: readonly Bounds[]): void;
};

export type Sublevels = {
  attach(scene: AssetId, opts: SublevelOptions): SublevelResult;
  detach(label: string): void;
  has(label: string): boolean;
  list(): readonly SublevelInfo[];
  /** At unload: forgets every sublevel, whose entities the unload removes. */
  clear(): void;
};

const movePt = ([x, y]: Pt, [dx, dy]: Pt): Pt => [roundLength(x + dx), roundLength(y + dy)];

function moveShape(s: ShapeObj, by: Pt): ShapeObj {
  const out = translateShape(s, by);
  if (out.type === "poly" || out.type === "chain")
    return { type: out.type, pts: out.pts.map(([x, y]) => [roundLength(x), roundLength(y)]) };
  return { ...out, cx: roundLength(out.cx), cy: roundLength(out.cy) };
}

function setAtPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur = root;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    if (next === null || typeof next !== "object") return;
    cur = next as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
}

/**
 * The sublevel's entities as they attach: ids `<label>:<id>`, every
 * reference to one of its own entities or instances renamed the same way,
 * positions moved by `at` (a type with a path keeps its shapes local to
 * it), `z` added.
 */
function placedEntities(
  registry: Registry,
  scene: ExpandedScene,
  instances: readonly string[],
  label: string,
  at: Pt,
  z: number,
): RuntimeEntity[] {
  const own = new Set([...scene.entities.map((e) => e.id), ...instances]);
  const rename = (v: unknown) => (typeof v === "string" && own.has(v) ? sublevelId(label, v) : v);
  const moving = at[0] !== 0 || at[1] !== 0;
  return scene.entities.map((src) => {
    const e: RuntimeEntity = { ...src, id: sublevelId(label, src.id) };
    if (e.parent !== undefined) e.parent = rename(e.parent) as string;
    const type = registry.types.get(e.type);
    if (!type) return e;
    for (const { field } of type.refs ?? []) {
      const value = valueAtPath(e, field);
      if (value === undefined) continue;
      setAtPath(e, field, Array.isArray(value) ? value.map(rename) : rename(value));
    }
    if (moving) {
      const fields = geometryFields(type).filter(({ field }) => e[field] != null);
      const onPath = fields.some((f) => f.kind === "path");
      for (const { field, kind } of fields) {
        const value = e[field];
        if (kind === "point") e[field] = movePt(value as Pt, at);
        else if (kind === "path") {
          const path = value as PathDef;
          e[field] = { ...path, pts: path.pts.map((p) => movePt(p, at)) };
        } else if (kind === "shape" && !onPath) e[field] = moveShape(value as ShapeObj, at);
      }
    }
    if (z !== 0) {
      const next = ((e.z as number | undefined) ?? 0) + z;
      if (next === 0) delete e.z;
      else e.z = next;
    }
    return e;
  });
}

/**
 * A runtime's sublevels: listed scenes attached beside the main scene,
 * each judged by `sublevelIssue` against it. Attach spawns now, inside a
 * step or out; detach destroys at the tick's destroy flush.
 */
export function createSublevels(host: SublevelHost): Sublevels {
  const attached = new Map<string, SublevelInfo & { bounds: Bounds }>();

  const syncBounds = () => host.bounds([...attached.values()].map((s) => s.bounds));

  function attach(scene: AssetId, opts: SublevelOptions): SublevelResult {
    const { label } = opts;
    const at: Pt = opts.at ? [opts.at[0], opts.at[1]] : [0, 0];
    const library = host.library();
    const main = host.main();
    if (!library || !main) {
      return {
        ok: false,
        issue: makeIssue("sublevel-invalid", {
          message: !main
            ? `"${scene}" can't attach: no main scene is loaded`
            : `"${scene}" can't attach: this runtime has no scene list`,
          entityIds: [scene],
          detail: { reason: "unlisted", scene, label },
        }),
      };
    }
    const expanded = expandListed(library, scene, host.ctx, "attach");
    if (!expanded.ok) return expanded;
    const refused = sublevelIssue(main, expanded.scene, {
      scene,
      list: library.list,
      label,
      at,
      taken: (l) => attached.has(l) || host.holds(l),
      pxPerMetre: pxPerMetreOf(host.registry),
    });
    if (refused) return { ok: false, issue: refused };

    const def = library.scenes.get(scene)!.def;
    const entities = placedEntities(
      host.registry,
      expanded.scene,
      (def.instances ?? []).map((i) => i.id),
      label,
      at,
      opts.z ?? 0,
    );
    try {
      host.place(entities);
    } catch (err) {
      const engine = err instanceof EngineError ? err : null;
      return {
        ok: false,
        issue: makeIssue(engine?.code === "physics-required" ? "physics-required" : "schema", {
          message: `"${scene}" failed to attach as "${label}": ${err instanceof Error ? err.message : String(err)}`,
          entityIds: engine?.entityId ? [engine.entityId] : [scene],
        }),
      };
    }
    const [x0, y0, x1, y1] = expanded.scene.bounds;
    attached.set(label, {
      label,
      scene,
      at,
      bounds: [
        roundLength(x0 + at[0]),
        roundLength(y0 + at[1]),
        roundLength(x1 + at[0]),
        roundLength(y1 + at[1]),
      ],
    });
    syncBounds();
    return { ok: true, entities: entities.map((e) => e.id) };
  }

  return {
    attach,
    detach(label) {
      if (!attached.delete(label)) return;
      host.destroy(label);
      syncBounds();
    },
    has: (label) => attached.has(label),
    list: () =>
      [...attached.values()].map(({ label, scene, at }) => ({ label, scene, at: [at[0], at[1]] })),
    clear() {
      attached.clear();
    },
  };
}

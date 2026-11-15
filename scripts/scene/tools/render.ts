import { writeFile } from "node:fs/promises";

import {
  stringTableData,
  textFontOf,
  type DebugDrawCommand,
  type StringTableData,
  tileTraits,
} from "@jams/engine/game";
import { runProbe } from "@jams/engine/headless";
import {
  localeFont,
  localeSettingsOf,
  projectView,
  type ProjectRuntimeView,
  type ProjectView,
  type TilesetFile,
} from "@jams/engine/project";
import {
  formatAsciiMap,
  renderSceneSvg,
  sceneAsciiMap,
  sceneSprites,
  roundLength,
  sceneViewport,
  expandScene,
  type Aabb,
  type Bounds,
  type PrefabLibrary,
  type Registry,
  type SceneDefinition,
  type SceneLabels,
  type SceneOverlay,
  type SceneRegionOptions,
} from "@jams/engine/scene";
import type { ProjectScan } from "@jams/engine/vite";

import {
  failure,
  openScene,
  readArg,
  usage,
  UsageError,
  type Tool,
  type ToolResult,
} from "../context";
import { projectRuntime, scanProject, type ProjectHandle } from "../projects";
import { rasterizeSvg } from "../raster";
import { rapierFor } from "./step";

/**
 * Every tileset's tiles as `tileTraits` judges them, by tileset id then
 * tile id: the data renders take, so the schematic and the colliders agree.
 */
export function projectTileTraits(
  runtime: Pick<ProjectRuntimeView, "doc" | "docs">,
): Record<string, Record<number, { solid: boolean }>> {
  const out: Record<string, Record<number, { solid: boolean }>> = {};
  for (const id of runtime.docs?.("tileset") ?? []) {
    const tileset = runtime.doc?.<TilesetFile>("tileset", id);
    if (!tileset) continue;
    const tiles: Record<number, { solid: boolean }> = {};
    for (const def of tileset.tiles ?? []) tiles[def.id] = { solid: tileTraits(def).solid };
    out[id] = tiles;
  }
  return out;
}

const hasTilemap = (def: SceneDefinition, registry: Registry) =>
  (def.entities ?? []).some((e) => {
    const type = registry.types.get(e.type);
    return e.type === "tilemap" || type?.base === "tilemap";
  });

/** The view of the project a scene is in, which sizes its sprites; undefined outside every project. */
export async function sceneProjectView(
  project: ProjectHandle | null,
  scan?: ProjectScan,
): Promise<ProjectView | undefined> {
  if (!project) return undefined;
  return projectView((scan ?? (await scanProject(project))).state, project.kinds);
}

/**
 * What keyed text in a project's scenes is measured in: its default
 * locale's strings and font, the data the shell hands a scene view.
 * Undefined outside every project.
 */
export async function sceneStrings(
  project: ProjectHandle | null,
  registry: Registry,
  scan?: ProjectScan,
): Promise<StringTableData | undefined> {
  if (!project) return undefined;
  const runtime = await projectRuntime(project, registry, scan);
  const locales = localeSettingsOf(runtime.engine.locales);
  const font = textFontOf((id) => runtime.asset(id), localeFont(locales, locales.default));
  return stringTableData(runtime, locales.default, font);
}

/** A derived box in metres, each side to the format's rounding rule. */
export const roundBox = (b: Aabb): Aabb => ({
  minX: roundLength(b.minX),
  minY: roundLength(b.minY),
  maxX: roundLength(b.maxX),
  maxY: roundLength(b.maxY),
});

/** Each sprite's ref, label and world box in metres, for a render's data; omitted when the scene has none. */
function spriteRows(
  def: SceneDefinition,
  opts: { registry: Registry; prefabs?: PrefabLibrary; project?: ProjectView },
) {
  const sprites = sceneSprites(def, opts).map(({ ref, type, label, box }) => ({
    ref,
    type,
    label,
    box: roundBox(box),
  }));
  return sprites.length > 0 ? { sprites } : {};
}

export type RenderInput = {
  scene?: string;
  out?: string;
  region?: string;
  around?: string;
  margin?: string;
  labels?: string;
  scale?: string;
  ascii?: boolean;
  overlay?: string;
  /** Run the scene headless and draw the last tick's `ctx.debug` shapes. */
  debugDraw?: boolean;
  /** With `debugDraw`: ticks to run, default `DEBUG_DRAW_TICKS`. */
  ticks?: string;
};

/** The ticks `--debug-draw` runs without `--ticks`: one second at 60 Hz. */
export const DEBUG_DRAW_TICKS = 60;
const MAX_DEBUG_DRAW_TICKS = 60 * 60 * 10;

const LABELS: readonly SceneLabels[] = ["entities", "all", "none"];

/** `x0,y0,x1,y1` in metres. */
function parseRegion(text: string): Bounds | null {
  const parts = text.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [x0, y0, x1, y1] = parts as Bounds;
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

/** A playtest report, a run recording, a blocked playtest or `validate --json` output: whatever of `SceneOverlay` it carries. */
async function readOverlay(
  ctx: Parameters<Tool<RenderInput>>[1],
  arg: string,
): Promise<SceneOverlay> {
  let value: unknown;
  try {
    value = JSON.parse(await readArg(ctx, arg));
  } catch (e) {
    if (e instanceof UsageError) throw e;
    const reason = (e as { code?: string }).code === "ENOENT" ? "not found" : (e as Error).message;
    throw new UsageError(`--overlay ${arg}: ${reason}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UsageError(`--overlay ${arg}: expected a JSON object such as a playtest report`);
  }
  const { issues, trail, outcome, markers } = value as Record<string, unknown>;
  // A run recording names its events `markers`.
  const events = (value as Record<string, unknown>).events ?? markers;
  return {
    ...(Array.isArray(issues) ? { issues: issues as SceneOverlay["issues"] } : {}),
    ...(trail && typeof trail === "object" ? { trail: trail as SceneOverlay["trail"] } : {}),
    ...(Array.isArray(events) ? { events: events as SceneOverlay["events"] } : {}),
    ...(outcome && typeof outcome === "object"
      ? { outcome: outcome as SceneOverlay["outcome"] }
      : {}),
  };
}

type Parsed = SceneRegionOptions & { scale?: number; labels?: SceneLabels; ticks?: number };

function parseFlags(input: RenderInput): Parsed | ToolResult {
  const out: Parsed = {};
  if (input.region !== undefined) {
    const region = parseRegion(input.region);
    if (!region) return usage("--region takes x0,y0,x1,y1 in metres with x1 > x0 and y1 > y0");
    out.region = region;
  }
  if (input.around !== undefined) out.around = input.around;
  if (input.margin !== undefined) {
    const margin = Number(input.margin);
    if (!Number.isFinite(margin) || margin < 0)
      return usage("--margin takes a number of metres, 0 or more");
    if (input.around === undefined) return usage("--margin needs --around");
    out.margin = margin;
  }
  if (input.scale !== undefined) {
    const scale = Number(input.scale);
    if (!Number.isFinite(scale) || scale <= 0) return usage("--scale takes a positive number");
    out.scale = scale;
  }
  if (input.labels !== undefined) {
    if (!(LABELS as readonly string[]).includes(input.labels)) {
      return usage(`--labels takes ${LABELS.join(" | ")}`);
    }
    out.labels = input.labels as SceneLabels;
  }
  if (input.ticks !== undefined) {
    if (!input.debugDraw) return usage("--ticks needs --debug-draw");
    const ticks = Number(input.ticks);
    if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_DEBUG_DRAW_TICKS)
      return usage(`--ticks must be an integer from 1 to ${MAX_DEBUG_DRAW_TICKS}`);
    out.ticks = ticks;
  }
  return out;
}

export const render: Tool<RenderInput> = async (input, ctx) => {
  const flags = parseFlags(input);
  if ("exitCode" in flags) return flags;
  const format =
    input.out === undefined ? null : /\.(png|svg|txt)$/i.exec(input.out)?.[1]?.toLowerCase();
  if (format === undefined) return usage("--out must end in .png, .svg or .txt");
  if (format === "txt" && !input.ascii) return usage("--out file.txt needs --ascii");
  if (input.ascii && (format === "png" || format === "svg")) {
    return usage("--ascii writes text; give --out a .txt file or leave it off");
  }
  if (input.ascii && (flags.scale !== undefined || flags.labels !== undefined)) {
    return usage("--scale and --labels are for images, not --ascii");
  }
  if (input.ascii && input.debugDraw) return usage("--debug-draw is for images, not --ascii");
  const { ticks: debugTicks, ...view } = flags;

  const loaded = await openScene(ctx, input.scene, "render <scene|file|->");
  if (!loaded.ok) return loaded.result;
  const { name, def, registry, prefabs } = loaded;
  const scan = loaded.project ? await scanProject(loaded.project) : undefined;
  const project = await sceneProjectView(loaded.project, scan);
  const strings = await sceneStrings(loaded.project, registry, scan);
  const tileTraitsOpt =
    loaded.project && hasTilemap(def, registry)
      ? { tileTraits: projectTileTraits(await projectRuntime(loaded.project, registry, scan)) }
      : {};

  let overlay: SceneOverlay | undefined;
  if (input.overlay !== undefined) {
    try {
      overlay = await readOverlay(ctx, input.overlay);
    } catch (e) {
      if (e instanceof UsageError) return usage(e.message);
      throw e;
    }
  }

  let debugDraw: readonly DebugDrawCommand[] | undefined;
  let ran: { ticks: number } | undefined;
  if (input.debugDraw) {
    const runtime = loaded.project ? await projectRuntime(loaded.project, registry, scan) : null;
    const engine = runtime?.engine;
    const report = runProbe({
      rapier: await rapierFor(ctx, def, registry, engine),
      game: registry.game,
      registry,
      project: runtime,
      scene: expandScene(def, registry, { prefabs, engine }),
      library: prefabs,
      ticks: debugTicks ?? DEBUG_DRAW_TICKS,
      collectDebugDraw: true,
    });
    if (!report.load.ok) return failure(`${name}: failed to load: ${report.load.error}`);
    debugDraw = report.debug ?? [];
    ran = { ticks: report.ticks };
  }

  try {
    if (input.ascii) {
      const map = sceneAsciiMap(def, {
        ...view,
        registry,
        prefabs,
        ...(project ? { project } : {}),
        ...(strings ? { strings } : {}),
        ...tileTraitsOpt,
        ...(overlay ? { overlay } : {}),
      });
      const text = formatAsciiMap(map);
      if (input.out) await writeFile(input.out, `${text}\n`, "utf8");
      return {
        exitCode: 0,
        data: {
          ok: true,
          scene: name,
          ...(input.out ? { out: input.out } : {}),
          ...map,
          ...spriteRows(def, { registry, prefabs, project }),
        },
        text: input.out
          ? `wrote ${input.out} (${map.cols} x ${map.rows} cells of ${map.cell}px)`
          : text,
      };
    }

    const opts = {
      ...view,
      registry,
      prefabs,
      ...(project ? { project } : {}),
      ...(strings ? { strings } : {}),
      ...tileTraitsOpt,
      ...(overlay ? { overlay } : {}),
      ...(debugDraw ? { debugDraw } : {}),
    };
    const svg = renderSceneSvg(def, opts);
    const { region, pxPerMetre, scale, width, height, tick } = sceneViewport(def, opts);
    const debug =
      debugDraw && ran ? { debugDraw: { ticks: ran.ticks, draws: debugDraw.length } } : {};
    const shown = {
      region,
      pxPerMetre,
      scale,
      width,
      height,
      tick,
      ...spriteRows(def, opts),
      ...debug,
    };
    if (!input.out) {
      return { exitCode: 0, data: { ok: true, scene: name, ...shown, svg }, text: svg.trimEnd() };
    }
    const bytes = format === "png" ? (await rasterizeSvg(svg)).png : svg;
    await writeFile(input.out, bytes);
    return {
      exitCode: 0,
      data: { ok: true, scene: name, out: input.out, format, ...shown },
      text:
        `wrote ${input.out} (${width}x${height}, scale ${Math.round(scale * 1000) / 1000}, region ${region.join(",")} m, ticks every ${tick}px)` +
        (ran ? `; ${debugDraw?.length ?? 0} debug draws after ${ran.ticks} ticks` : ""),
    };
  } catch (e) {
    if (e instanceof Error && /^(no entity|region|scale)/.test(e.message)) return usage(e.message);
    return failure(e instanceof Error ? e.message : String(e));
  }
};

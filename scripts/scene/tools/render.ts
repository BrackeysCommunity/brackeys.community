import { writeFile } from "node:fs/promises";

import {
  formatAsciiMap,
  renderSceneSvg,
  sceneAsciiMap,
  sceneViewport,
  type Bounds,
  type SceneLabels,
  type SceneOverlay,
  type SceneRegionOptions,
} from "@jams/engine/scene";

import {
  failure,
  openScene,
  readArg,
  usage,
  UsageError,
  type Tool,
  type ToolResult,
} from "../context";
import { rasterizeSvg } from "../raster";

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
};

const LABELS: readonly SceneLabels[] = ["entities", "all", "none"];

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

type Parsed = SceneRegionOptions & { scale?: number; labels?: SceneLabels };

function parseFlags(input: RenderInput): Parsed | ToolResult {
  const out: Parsed = {};
  if (input.region !== undefined) {
    const region = parseRegion(input.region);
    if (!region) return usage("--region takes x0,y0,x1,y1 with x1 > x0 and y1 > y0");
    out.region = region;
  }
  if (input.around !== undefined) out.around = input.around;
  if (input.margin !== undefined) {
    const margin = Number(input.margin);
    if (!Number.isFinite(margin) || margin < 0)
      return usage("--margin takes a number of px, 0 or more");
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

  const loaded = await openScene(ctx, input.scene, "render <scene|file|->");
  if (!loaded.ok) return loaded.result;
  const { name, def, registry, prefabs } = loaded;

  let overlay: SceneOverlay | undefined;
  if (input.overlay !== undefined) {
    try {
      overlay = await readOverlay(ctx, input.overlay);
    } catch (e) {
      if (e instanceof UsageError) return usage(e.message);
      throw e;
    }
  }

  try {
    if (input.ascii) {
      const map = sceneAsciiMap(def, {
        ...flags,
        registry,
        prefabs,
        ...(overlay ? { overlay } : {}),
      });
      const text = formatAsciiMap(map);
      if (input.out) await writeFile(input.out, `${text}\n`, "utf8");
      return {
        exitCode: 0,
        data: { ok: true, scene: name, ...(input.out ? { out: input.out } : {}), ...map },
        text: input.out
          ? `wrote ${input.out} (${map.cols} x ${map.rows} cells of ${map.cell}px)`
          : text,
      };
    }

    const opts = { ...flags, registry, prefabs, ...(overlay ? { overlay } : {}) };
    const svg = renderSceneSvg(def, opts);
    const { region, scale, width, height, tick } = sceneViewport(def, opts);
    const view = { region, scale, width, height, tick };
    if (!input.out) {
      return { exitCode: 0, data: { ok: true, scene: name, ...view, svg }, text: svg.trimEnd() };
    }
    const bytes = format === "png" ? (await rasterizeSvg(svg)).png : svg;
    await writeFile(input.out, bytes);
    return {
      exitCode: 0,
      data: { ok: true, scene: name, out: input.out, format, ...view },
      text: `wrote ${input.out} (${width}x${height}, scale ${Math.round(scale * 1000) / 1000}, region ${region.join(",")}, ticks every ${tick}px)`,
    };
  } catch (e) {
    if (e instanceof Error && /^(no entity|region|scale)/.test(e.message)) return usage(e.message);
    return failure(e instanceof Error ? e.message : String(e));
  }
};

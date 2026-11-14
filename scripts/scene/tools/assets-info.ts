import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveClips, type ResolvedClip } from "@jams/engine/game";
import {
  animationIssues,
  animationKind,
  ANIMATION_KIND,
  assetInfo,
  parseAssetDoc,
  projectView,
  type AnimationFile,
  type AssetInfo,
  type ProjectView,
} from "@jams/engine/project";
import {
  aabb,
  aabbUnion,
  closest,
  resolveTime,
  type Aabb,
  type SceneIssue,
  type ShapeObj,
} from "@jams/engine/scene";

import { failure, issueLine, usage, type ToolContext, type ToolResult } from "../context";
import { locateInProjects, scanProject, type ProjectHandle } from "../projects";
import { roundBox } from "./render";
import { boxText } from "./show";
import { projectEngine } from "./step";

export type AssetsInfoInput = { id?: string; frame?: string };

const pair = (p: readonly number[]) => p.join(",");

function infoLines(info: AssetInfo, path: string, frame: string | undefined): string[] {
  const lines = [`${info.id}  ${info.kind}  ${path}`];
  if (info.sha256 !== undefined || info.bytes !== undefined)
    lines.push(
      `  ${[info.sha256, info.bytes === undefined ? undefined : `${info.bytes} B`].filter((s) => s !== undefined).join("  ")}`,
    );
  const size = info.size ? `${info.size[0]}×${info.size[1]}` : undefined;
  const shape = [size, info.pivot ? `pivot ${pair(info.pivot)}` : undefined]
    .filter((s) => s !== undefined)
    .join(", ");
  if (frame !== undefined) lines.push(`  frame ${frame}: ${shape || "no size"}`);
  else if (shape) lines.push(`  ${shape}`);
  if (info.nineSlice) lines.push(`  nine-slice ${pair(info.nineSlice)}`);
  if (info.filter) lines.push(`  filter ${info.filter}`);
  if (info.frames) lines.push(`  frames: ${info.frames.join(", ") || "none"}`);
  if (info.tags && info.tags.length > 0)
    lines.push(
      `  tags: ${info.tags.map((t) => `${t.name} ${t.from}-${t.to} ${t.direction}`).join(", ")}`,
    );
  if (info.texture !== undefined) lines.push(`  texture ${info.texture}`);
  return lines;
}

/** One frame of a clip as the report gives it: its ticks at the run's rate and each shape set's box, metres. */
export type ClipFrameInfo = {
  frame: string;
  ticks: number;
  events: readonly string[];
  shapes: Record<string, Aabb>;
};

/** One clip as a run plays it at `AnimationInfo.rate`; `length` is one pass in ticks. */
export type ClipInfo = {
  name: string;
  loop: ResolvedClip["loop"];
  speed: number;
  next: string | null;
  length: number;
  frames: ClipFrameInfo[];
};

/**
 * An animation doc's clips resolved at the project's tick rate, and its
 * issues: a clip an error points into is left out of `clips` and named in
 * `leftOut`; a file that isn't an animation at all has its read issues and
 * no clips.
 */
export type AnimationInfo = {
  atlas: string | null;
  rate: number;
  clips: ClipInfo[];
  leftOut: string[];
  issues: SceneIssue[];
};

/** The box around a shape set, rounded as `show` rounds boxes. */
const shapeBox = (shapes: readonly ShapeObj[]): Aabb =>
  roundBox(shapes.map(aabb).reduce(aabbUnion));

function clipInfo(clip: ResolvedClip): ClipInfo {
  return {
    name: clip.name,
    loop: clip.loop,
    speed: clip.speed,
    next: clip.next,
    length: clip.length,
    frames: clip.frames.map((f) => ({
      frame: f.frame,
      ticks: f.ticks,
      events: f.events,
      shapes: Object.fromEntries(
        Object.entries(f.shapes)
          .filter(([, shapes]) => shapes.length > 0)
          .map(([set, shapes]) => [set, shapeBox(shapes)]),
      ),
    })),
  };
}

/**
 * The animation at `path` in `project` as a run resolves it: its clips at
 * the project's tick rate (else the game's) through `resolveClips`, whose
 * issues are `animationIssues` against the atlas. A file the rule refuses
 * still resolves, without the clips its errors point into; one that isn't
 * an animation's shape gives only its read issues.
 */
async function animationInfo(
  project: ProjectHandle,
  view: ProjectView,
  path: string,
): Promise<AnimationInfo> {
  const env = { registry: project.registry, project: view };
  const text = await readFile(join(project.dir, path), "utf8");
  const read = parseAssetDoc(animationKind, text, env);
  let file: AnimationFile | undefined;
  if (read.ok) file = read.value;
  else {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    const shaped = animationKind.schema().safeParse(raw);
    if (shaped.success) file = shaped.data;
  }
  const { rate } = resolveTime({
    project: await projectEngine(project, project.registry),
    game: project.registry.time,
  });
  if (!file) return { atlas: null, rate, clips: [], leftOut: [], issues: read.issues };
  const atlas = assetInfo(view, file.atlas);
  const resolved = atlas ? resolveClips({ animation: file }, atlas, { rate }) : null;
  const clips = resolved ? [...resolved.clips.values()].map(clipInfo) : [];
  const kept = new Set(clips.map((c) => c.name));
  return {
    atlas: file.atlas,
    rate,
    clips,
    leftOut: [...new Set(file.clips.map((c) => c.name).filter((n) => !kept.has(n)))],
    issues: resolved ? resolved.issues : animationIssues(file, null),
  };
}

/** `hero-1 5t [strike] hit 0.06,-0.04..0.18,0.04 m`. */
function frameText(f: ClipFrameInfo): string {
  const events = f.events.length > 0 ? ` [${f.events.join(", ")}]` : "";
  const shapes = Object.entries(f.shapes)
    .map(([set, box]) => ` ${set} ${boxText(box)}`)
    .join("");
  return `${f.frame} ${f.ticks}t${events}${shapes}`;
}

function animationLines(anim: AnimationInfo): string[] {
  const lines = [
    `  atlas ${anim.atlas ?? "(unread)"}; clips at ${anim.rate}Hz, frame lengths in ticks`,
  ];
  for (const c of anim.clips) {
    const next = c.next === null ? "" : ` -> ${c.next}`;
    const speed = c.speed === 1 ? "" : ` ×${c.speed}`;
    const frames = `${c.frames.length} frame${c.frames.length === 1 ? "" : "s"}`;
    lines.push(`  clip ${c.name}  ${c.loop}${next}${speed}  ${frames}, ${c.length} ticks a pass`);
    lines.push(...c.frames.map((f, i) => `    ${i} ${frameText(f)}`));
  }
  if (anim.clips.length === 0 && anim.leftOut.length === 0) lines.push("  clips: none");
  if (anim.leftOut.length > 0) lines.push(`  left out: ${anim.leftOut.join(", ")}`);
  lines.push(...anim.issues.map(issueLine));
  return lines;
}

/**
 * `assetInfo` of a live asset from its project's files: kind, hash and
 * bytes, a texture's size and import pivot, nine-slice and filter, an
 * atlas's frames, tags and texture, and with `--frame` that frame's size
 * and pivot; an animation's clips with their frames, ticks at the
 * project's rate, events, shape sets and issues. The id is looked up across
 * projects, `--project` picking one.
 */
export async function assetsInfo(input: AssetsInfoInput, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id;
  if (id === undefined) return usage("assets info <id> [--frame f]");
  const views = new Map<ProjectHandle, Promise<ProjectView>>();
  const viewOf = (p: ProjectHandle) => {
    let hit = views.get(p);
    if (!hit) views.set(p, (hit = scanProject(p).then((scan) => projectView(scan.state, p.kinds))));
    return hit;
  };
  const found = await locateInProjects(
    ctx.projects,
    id,
    async (p) => (await viewOf(p)).byId.has(id),
    ctx.project,
  );
  if (!found.ok) {
    if (found.exitCode === 2) return usage(found.message);
    const ids = (await Promise.all([...views.values()])).flatMap((v) => [...v.byId.keys()]);
    const guess = closest(id, ids);
    return failure(`${found.message}${guess ? ` Did you mean "${guess}"?` : ""}`, { id });
  }
  const view = await viewOf(found.project);
  const info = assetInfo(view, id, input.frame);
  const project = found.project.file.id;
  if (!info) {
    const frames = assetInfo(view, id)?.frames ?? [];
    const guess = closest(input.frame ?? "", frames);
    return failure(
      `"${id}" has no frame ${JSON.stringify(input.frame)}${guess ? `; did you mean "${guess}"?` : frames.length > 0 ? "" : "; it has no frames"}`,
      { project, id, frame: input.frame },
    );
  }
  const path = view.byId.get(id)!.path;
  const animation =
    info.kind === ANIMATION_KIND && input.frame === undefined
      ? await animationInfo(found.project, view, path)
      : null;
  return {
    exitCode: 0,
    data: {
      ok: true,
      project,
      id,
      path,
      ...(input.frame !== undefined ? { frame: input.frame } : {}),
      info,
      ...(animation ? { animation } : {}),
    },
    text: [
      ...infoLines(info, path, input.frame),
      ...(animation ? animationLines(animation) : []),
    ].join("\n"),
  };
}

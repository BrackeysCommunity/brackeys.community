import { assetInfo, projectView, type AssetInfo, type ProjectView } from "@jams/engine/project";
import { closest } from "@jams/engine/scene";

import { failure, usage, type ToolContext, type ToolResult } from "../context";
import { locateInProjects, scanProject, type ProjectHandle } from "../projects";

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

/**
 * `assetInfo` of a live asset from its project's files: kind, hash and
 * bytes, a texture's size and import pivot, nine-slice and filter, an
 * atlas's frames, tags and texture, and with `--frame` that frame's size
 * and pivot. The id is looked up across projects, `--project` picking one.
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
  return {
    exitCode: 0,
    data: {
      ok: true,
      project,
      id,
      path,
      ...(input.frame !== undefined ? { frame: input.frame } : {}),
      info,
    },
    text: infoLines(info, path, input.frame).join("\n"),
  };
}

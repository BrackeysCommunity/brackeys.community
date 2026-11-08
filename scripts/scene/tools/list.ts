import { readFile } from "node:fs/promises";

import { expandScene, parseScene, sceneHash, validateScene } from "@jams/engine/scene";
import type { ProjectScan } from "@jams/engine/vite";

import { clashes, judgeScene, listSceneFiles, prefabsOf, type Tool } from "../context";
import { scanProject, type ProjectHandle } from "../projects";
import { countEntities } from "./show";

export type ListInput = Record<string, never>;

export const list: Tool<ListInput> = async (_input, ctx) => {
  const files = await listSceneFiles(ctx);
  const scans = new Map<ProjectHandle, Promise<ProjectScan>>();
  const scanOf = (project: ProjectHandle) => {
    let scan = scans.get(project);
    if (!scan) scans.set(project, (scan = scanProject(project)));
    return scan;
  };
  const scenes = await Promise.all(
    files.map(async ({ name, home, file, project }) => {
      const text = await readFile(file, "utf8");
      const judged = judgeScene(ctx, text, undefined, project);
      const game = judged.game ?? null;
      const failed = (issues: number) => ({ name, home, game, ok: false as const, issues });
      if (!judged.ok) return failed(1);
      const parsed = parseScene(text, judged.registry);
      if (!parsed.ok) return failed(parsed.issues.length);
      const def = parsed.def;
      const prefabs = await prefabsOf({ project }, judged.registry, await scanOf(project));
      const issues = { error: 0, warn: 0, info: 0 };
      for (const i of validateScene(def, judged.registry, { prefabs })) issues[i.severity]++;
      return {
        name,
        home,
        game,
        ok: true as const,
        sceneHash: sceneHash(def),
        bounds: def.bounds,
        counts: countEntities(expandScene(def, judged.registry, { prefabs })),
        issues,
      };
    }),
  );
  const clashing = clashes(files);
  const lines = scenes.map((s) => {
    const head = `${s.name}  ${s.game ?? "(no game)"}`;
    if (!s.ok) return `${head}  (fails to parse: ${s.issues} issues)`;
    const counts = Object.entries(s.counts)
      .map(([t, n]) => `${t}:${n}`)
      .join(" ");
    const { error, warn, info } = s.issues;
    return `${head}  ${s.sceneHash}  bounds ${s.bounds.join(",")}  issues ${error}/${warn}/${info}  ${counts}`;
  });
  for (const [name, homes] of clashing) lines.push(`clash: ${name} is in ${homes.join(", ")}`);
  return {
    exitCode: 0,
    data: { ok: true, scenes, clashes: Object.fromEntries(clashing) },
    text: lines.join("\n") || "no scenes",
  };
};

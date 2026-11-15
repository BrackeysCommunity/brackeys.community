import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { validatePhysical } from "@jams/engine/headless";
import { projectView, validateProject, type AssetId, type ProjectView } from "@jams/engine/project";
import {
  lineAt,
  pointerLines,
  sceneHash,
  validateScene,
  type SceneDefinition,
  type SceneIssue,
} from "@jams/engine/scene";

import {
  issueLine,
  judgeScene,
  parseSceneWith,
  prefabHomeOf,
  prefabLookup,
  prefabsOf,
  readSource,
  usage,
  type Tool,
} from "../context";
import { projectRuntime, scanProject, type ProjectHandle } from "../projects";
import { rapierFor } from "./step";

export type ValidateInput = { target?: string; physical?: boolean };

function withLine(issue: SceneIssue, lines: ReadonlyMap<string, number> | undefined): SceneIssue {
  if (issue.line !== undefined || !lines || issue.path === undefined) return issue;
  const line = lineAt(lines, issue.path);
  return line === undefined ? issue : { ...issue, line };
}

const issueKey = (i: SceneIssue) => `${i.code}\u0000${i.path ?? ""}\u0000${i.message}`;

/**
 * `validateProject` over every doc of the project as its files hold them,
 * the scene's own as `text`. The scene's issues (those its own checks
 * didn't already give, its id dropped from `entityIds`) are split from the
 * other docs' (which name their doc first); each gets its line.
 */
async function projectIssues(
  project: ProjectHandle,
  view: ProjectView,
  scene: { file: string; text: string; lines: ReadonlyMap<string, number> },
  own: readonly SceneIssue[],
  prefab: ReturnType<typeof prefabLookup>,
): Promise<{ scene: SceneIssue[]; others: SceneIssue[] }> {
  const scenePath = relative(project.dir, resolve(scene.file)).split("\\").join("/");
  let sceneId: AssetId | undefined;
  const texts = new Map<AssetId, string>();
  for (const entry of view.byId.values()) {
    if (project.kinds.get(entry.kind)?.storage !== "doc") continue;
    if (entry.path === scenePath) {
      sceneId = entry.id;
      texts.set(entry.id, scene.text);
      continue;
    }
    try {
      texts.set(entry.id, await readFile(join(project.dir, entry.path), "utf8"));
    } catch {
      // A file gone since the scan is left out.
    }
  }
  const issues = validateProject(view, texts, project.kinds, {
    registry: project.registry,
    project: view,
    prefab,
  });
  const seen = new Set(own.map(issueKey));
  const out = { scene: [] as SceneIssue[], others: [] as SceneIssue[] };
  for (const issue of issues) {
    const [doc, ...ids] = issue.entityIds;
    if (doc !== undefined && doc === sceneId) {
      if (!seen.has(issueKey(issue)))
        out.scene.push(withLine({ ...issue, entityIds: ids }, scene.lines));
      continue;
    }
    const text = doc === undefined ? undefined : texts.get(doc);
    out.others.push(withLine(issue, text === undefined ? undefined : linesOf(text)));
  }
  return out;
}

function linesOf(text: string): ReadonlyMap<string, number> | undefined {
  try {
    return pointerLines(text);
  } catch {
    return undefined;
  }
}

function tally(issues: SceneIssue[]) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return counts;
}

export const validate: Tool<ValidateInput> = async (input, ctx) => {
  const target = input.target;
  if (!target) return usage("scene validate <scene|file|-> [--physical]");
  const source = await readSource(ctx, target);
  if (!source.ok) return source.result;
  const { text } = source;

  const judged = judgeScene(ctx, text, undefined, source.project);
  const game = judged.game ?? null;
  let issues: SceneIssue[];
  let others: SceneIssue[] | undefined;
  let def: SceneDefinition | undefined;
  if (!judged.ok) issues = [judged.issue];
  else {
    const scan = source.project ? await scanProject(source.project) : undefined;
    const prefabs = await prefabsOf(prefabHomeOf(source, target), judged.registry, scan);
    const parsed = parseSceneWith(text, judged.registry, prefabs);
    if (parsed.ok) {
      def = parsed.def;
      const lines = pointerLines(text);
      const project =
        source.project && scan ? projectView(scan.state, source.project.kinds) : undefined;
      const runtime =
        source.project && scan
          ? await projectRuntime(source.project, judged.registry, scan)
          : undefined;
      const engine = runtime?.engine;
      issues = [
        ...parsed.issues,
        ...validateScene(def, judged.registry, { lines, prefabs, project, runtime, engine }),
      ];
      if (source.project && project) {
        const file = source.scene?.file ?? target;
        const found = await projectIssues(
          source.project,
          project,
          { file, text, lines },
          issues,
          prefabLookup(prefabs),
        );
        issues.push(...found.scene);
        others = found.others;
      }
      if (input.physical) {
        const rapier = await rapierFor(ctx, def, judged.registry, engine);
        issues.push(
          ...validatePhysical({
            rapier,
            scene: def,
            registry: judged.registry,
            lines,
            prefabs,
            engine,
          }),
        );
      }
    } else issues = parsed.issues;
  }
  const counts = tally(issues);
  const ok = def !== undefined && counts.error === 0;
  const hash = def ? sceneHash(def) : undefined;
  const head = `${target}${hash ? ` ${hash}` : ""}${input.physical ? " (physical)" : ""}: ${counts.error} errors, ${counts.warn} warnings, ${counts.info} info`;
  const projectCounts = others && tally(others);
  const projectLines =
    others && projectCounts && others.length > 0
      ? [
          `project ${source.project!.file.id}, other docs: ${projectCounts.error} errors, ${projectCounts.warn} warnings, ${projectCounts.info} info`,
          ...others.map(issueLine),
        ]
      : [];
  return {
    exitCode: ok ? 0 : 1,
    data: {
      ok,
      scene: target,
      game,
      sceneHash: hash,
      physical: input.physical === true,
      counts,
      issues,
      ...(others && projectCounts
        ? { project: { id: source.project!.file.id, counts: projectCounts, issues: others } }
        : {}),
    },
    text: [head, ...issues.map(issueLine), ...projectLines].join("\n"),
  };
};

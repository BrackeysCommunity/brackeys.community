import { validatePhysical } from "@jams/engine/headless";
import {
  parseScene,
  pointerLines,
  sceneHash,
  validateScene,
  type SceneDefinition,
  type SceneIssue,
} from "@jams/engine/scene";

import {
  issueLine,
  judgeScene,
  prefabsOf,
  readSource,
  sceneDirOf,
  usage,
  type Tool,
} from "../context";

export type ValidateInput = { target?: string; physical?: boolean };

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

  const judged = judgeScene(ctx, text);
  const game = judged.game ?? null;
  let issues: SceneIssue[];
  let def: SceneDefinition | undefined;
  if (!judged.ok) issues = [judged.issue];
  else {
    const parsed = parseScene(text, judged.registry);
    if (parsed.ok) {
      def = parsed.def;
      const lines = pointerLines(text);
      const prefabs = await prefabsOf(sceneDirOf(source, target), judged.registry);
      issues = [...parsed.issues, ...validateScene(def, judged.registry, { lines, prefabs })];
      if (input.physical) {
        const rapier = await ctx.loadRapier();
        issues.push(
          ...validatePhysical({ rapier, scene: def, registry: judged.registry, lines, prefabs }),
        );
      }
    } else issues = parsed.issues;
  }
  const counts = tally(issues);
  const ok = def !== undefined && counts.error === 0;
  const hash = def ? sceneHash(def) : undefined;
  const head = `${target}${hash ? ` ${hash}` : ""}${input.physical ? " (physical)" : ""}: ${counts.error} errors, ${counts.warn} warnings, ${counts.info} info`;
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
    },
    text: [head, ...issues.map(issueLine)].join("\n"),
  };
};

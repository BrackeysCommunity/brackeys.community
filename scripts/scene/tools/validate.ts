import {
  parseScene,
  pointerLines,
  sceneHash,
  validateScene,
  type SceneIssue,
} from "@jams/engine/scene";
import { ScenePathError } from "@jams/engine/vite";

import {
  failure,
  isFileArg,
  issueLine,
  listSceneNames,
  readArg,
  readSceneText,
  usage,
  type Tool,
} from "../context";

export type ValidateInput = { target?: string };

function tally(issues: SceneIssue[]) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return counts;
}

export const validate: Tool<ValidateInput> = async (input, ctx) => {
  const target = input.target;
  if (!target) return usage("scene validate <scene|file>");
  let text: string;
  try {
    text =
      isFileArg(target) || target === "-"
        ? await readArg(ctx, target)
        : await readSceneText(ctx, target);
  } catch (e) {
    if (e instanceof ScenePathError) return usage(e.message);
    if ((e as { code?: string }).code === "ENOENT") {
      const stem = target.endsWith(".json") && !target.includes("/") ? target.slice(0, -5) : null;
      const isScene = stem !== null && (await listSceneNames(ctx)).includes(stem);
      return failure(
        isScene
          ? `Not found: ${target}. To validate the scene, pass its name: validate ${stem}.`
          : `Not found: ${target}.`,
      );
    }
    throw e;
  }

  const parsed = parseScene(text);
  const issues = parsed.ok
    ? [...parsed.issues, ...validateScene(parsed.def, { lines: pointerLines(text) })]
    : parsed.issues;
  const counts = tally(issues);
  const ok = parsed.ok && counts.error === 0;
  const hash = parsed.ok ? sceneHash(parsed.def) : undefined;
  const head = `${target}${hash ? ` ${hash}` : ""}: ${counts.error} errors, ${counts.warn} warnings, ${counts.info} info`;
  return {
    exitCode: ok ? 0 : 1,
    data: { ok, scene: target, sceneHash: hash, counts, issues },
    text: [head, ...issues.map(issueLine)].join("\n"),
  };
};

import { expandScene, parseScene, sceneHash } from "@jams/engine/scene";

import { listSceneNames, readSceneText, type Tool } from "../context";
import { countEntities } from "./show";

export type ListInput = Record<string, never>;

export const list: Tool<ListInput> = async (_input, ctx) => {
  const names = await listSceneNames(ctx);
  const scenes = await Promise.all(
    names.map(async (name) => {
      const parsed = parseScene(await readSceneText(ctx, name));
      if (!parsed.ok) return { name, ok: false as const, issues: parsed.issues.length };
      const def = parsed.def;
      return {
        name,
        ok: true as const,
        sceneHash: sceneHash(def),
        bounds: def.bounds,
        spawn: def.spawn.length,
        counts: countEntities(expandScene(def)),
      };
    }),
  );
  const text = scenes
    .map((s) =>
      s.ok
        ? `${s.name}  ${s.sceneHash}  bounds ${s.bounds.join(",")}  ${Object.entries(s.counts)
            .map(([b, n]) => `${b}:${n}`)
            .join(" ")}`
        : `${s.name}  (fails to parse: ${s.issues} issues)`,
    )
    .join("\n");
  return { exitCode: 0, data: { ok: true, scenes }, text: text || "no scenes" };
};

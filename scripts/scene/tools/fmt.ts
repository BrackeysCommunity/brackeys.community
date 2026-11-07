import { formatScene } from "@jams/engine/scene";

import { loadScene, writeSceneText, type Tool } from "../context";

export type FmtInput = { scene?: string; check?: boolean };

export const fmt: Tool<FmtInput> = async (input, ctx) => {
  const loaded = await loadScene(ctx, input.scene, "fmt [--check]");
  if (!loaded.ok) return loaded.result;
  const { text } = formatScene(loaded.def);
  const changed = text !== loaded.text;
  if (input.check) {
    return {
      exitCode: changed ? 1 : 0,
      data: { ok: !changed, scene: loaded.name, changed },
      text: changed
        ? `${loaded.name}: not canonical; run vp run scene fmt ${loaded.name}`
        : `${loaded.name}: canonical`,
    };
  }
  if (changed) await writeSceneText(loaded.scene, text);
  return {
    exitCode: 0,
    data: { ok: true, scene: loaded.name, changed },
    text: changed ? `${loaded.name}: formatted` : `${loaded.name}: already canonical`,
  };
};

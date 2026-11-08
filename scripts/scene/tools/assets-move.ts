import { usage, type Tool } from "../context";
import { runProjectBatch, type WriterFlags } from "./assets-apply";

export type AssetsMoveInput = WriterFlags & { ids?: string[]; to?: string };

const USAGE = "scene assets move <id...> --to <folder/> [writer flags]";

/** `""`, `/` and `.` are the project's root; any other folder ends with `/`. */
export function folderArg(to: string): string {
  const trimmed = to.replace(/^\.?\/+/, "");
  if (trimmed === "" || trimmed === ".") return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/** Moves assets into a folder of their project, sidecars and all. */
export const assetsMove: Tool<AssetsMoveInput> = async (input, ctx) => {
  const ids = input.ids ?? [];
  const [first] = ids;
  if (!first || input.to === undefined) return usage(USAGE);
  const to = folderArg(input.to);
  return runProjectBatch(ctx, input, {
    id: first,
    build: () => ({ v: 1, ops: [{ op: "moveAsset", ids, to }] }),
  });
};

import { usage, type Tool } from "../context";
import { runProjectBatch, type WriterFlags } from "./assets-apply";

export type AssetsDeleteInput = WriterFlags & { id?: string; force?: boolean };

const USAGE = "scene assets delete <id> [--force] [writer flags]";

/** Moves an asset to the trash; refused with `asset-in-use` while something names it, unless `--force`. */
export const assetsDelete: Tool<AssetsDeleteInput> = async (input, ctx) => {
  const { id } = input;
  if (!id) return usage(USAGE);
  return runProjectBatch(ctx, input, {
    id,
    build: () => ({
      v: 1,
      ops: [{ op: "deleteAsset", id, ...(input.force ? { force: true } : {}) }],
    }),
  });
};

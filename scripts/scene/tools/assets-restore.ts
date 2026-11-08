import { usage, type Tool } from "../context";
import { runProjectBatch, type WriterFlags } from "./assets-apply";

export type AssetsRestoreInput = WriterFlags & { id?: string };

const USAGE = "scene assets restore <id> [writer flags]";

/** Brings an asset back from the trash, to the path it left. */
export const assetsRestore: Tool<AssetsRestoreInput> = async (input, ctx) => {
  const { id } = input;
  if (!id) return usage(USAGE);
  return runProjectBatch(ctx, input, {
    id,
    trashed: true,
    build: () => ({ v: 1, ops: [{ op: "restoreAsset", id }] }),
  });
};

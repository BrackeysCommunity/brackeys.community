import { usage, type Tool } from "../context";
import { runProjectBatch, type WriterFlags } from "./assets-apply";

export type AssetsChangeIdInput = WriterFlags & { id?: string; to?: string };

const USAGE = "scene assets change-id <id> <new-id> [writer flags]";

/** Gives an asset a new id and rewrites every reference to it, in every doc, as one batch. */
export const assetsChangeId: Tool<AssetsChangeIdInput> = async (input, ctx) => {
  const { id, to } = input;
  if (!id || !to) return usage(USAGE);
  return runProjectBatch(ctx, input, {
    id,
    build: () => ({ v: 1, ops: [{ op: "changeAssetId", id, to }] }),
  });
};

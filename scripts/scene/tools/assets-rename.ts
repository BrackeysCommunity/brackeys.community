import { usage, type Tool } from "../context";
import { runProjectBatch, type WriterFlags } from "./assets-apply";

export type AssetsRenameInput = WriterFlags & { id?: string; name?: string; file?: string };

const USAGE = "scene assets rename <id> [--name text] [--file name.ext] [writer flags]";

/** Changes an asset's display name (`--name ""` clears it) and/or its file name in place; the id stays. */
export const assetsRename: Tool<AssetsRenameInput> = async (input, ctx) => {
  const { id } = input;
  if (!id || (input.name === undefined && input.file === undefined)) return usage(USAGE);
  return runProjectBatch(ctx, input, {
    id,
    build: () => ({
      v: 1,
      ops: [
        {
          op: "renameAsset",
          id,
          ...(input.name === undefined ? {} : { name: input.name === "" ? null : input.name }),
          ...(input.file === undefined ? {} : { file: input.file }),
        },
      ],
    }),
  });
};

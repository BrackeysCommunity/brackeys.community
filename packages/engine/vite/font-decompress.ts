import { brotliDecompressSync, inflateSync } from "node:zlib";

import type { FontDecompress } from "../project/inspect/font";

/** node:zlib lent to the font reader, so a WOFF or WOFF2 inspected on a Node or Bun host records its coverage. */
export const NODE_DECOMPRESS: FontDecompress = {
  inflate: (data) => inflateSync(data),
  brotli: (data) => brotliDecompressSync(data),
};

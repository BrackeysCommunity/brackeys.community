import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ID_PATTERN } from "../game/fields";
import { hashForPut, type ContentStore } from "../project/content-store";
import { isSha256 } from "../project/hash";
import type { ProjectId, Sha256 } from "../project/types";

/** Where the dev server keeps a project's cache, under the repo root: `node_modules/.cache/jams-engine/<project>`. */
export const DEV_CACHE_ROOT = "node_modules/.cache/jams-engine";

export function defaultCacheDir(project: ProjectId, root: string = process.cwd()): string {
  if (!ID_PATTERN.test(project))
    throw new Error(`project id "${project}" doesn't match ${ID_PATTERN}`);
  return join(root, DEV_CACHE_ROOT, project);
}

const isMissing = (error: unknown) =>
  error instanceof Error && (error as { code?: unknown }).code === "ENOENT";

/**
 * Bytes by content hash on disk, at `<cacheDir>/blobs/<sha256>`. A blob is
 * written to a temp file and renamed into place, so a reader never sees a
 * partial one; a hash already held is not written again.
 */
export function fileContentStore(cacheDir: string): ContentStore {
  const blobs = join(cacheDir, "blobs");
  const pathOf = (hash: Sha256) => join(blobs, hash);

  const has = async (hash: Sha256) => {
    if (!isSha256(hash)) return false;
    try {
      return (await stat(pathOf(hash))).isFile();
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  };

  return {
    has,
    async get(hash) {
      if (!isSha256(hash)) return null;
      try {
        return new Uint8Array(await readFile(pathOf(hash)));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async put(bytes, expect) {
      const hash = await hashForPut(bytes, expect);
      if (await has(hash)) return hash;
      await mkdir(blobs, { recursive: true });
      const tmp = join(blobs, `.${hash}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
      try {
        await writeFile(tmp, bytes);
        await rename(tmp, pathOf(hash));
      } catch (error) {
        await rm(tmp, { force: true });
        throw error;
      }
      return hash;
    },
  };
}

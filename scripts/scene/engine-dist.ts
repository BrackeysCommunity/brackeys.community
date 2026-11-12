import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** The engine package's source, which `vp pack` builds into `dist/`. */
export const ENGINE_PACKAGE_DIR = join(REPO_ROOT, "packages", "engine");
/** The workspace link an export resolves `@jams/engine` through, to the package's `dist`. */
export const ENGINE_LINK_DIR = join(REPO_ROOT, "node_modules", "@jams", "engine");
const DIST_ENTRY = join(ENGINE_PACKAGE_DIR, "dist", "index.mjs");
const LOCK_DIR = join(REPO_ROOT, "node_modules", ".engine-pack.lock");
const VP = join(REPO_ROOT, "node_modules", ".bin", "vp");
/** A pack of the whole engine, entries and types: bounded well past a loaded machine's time. */
const PACK_TIMEOUT_MS = 10 * 60_000;
/** A lock older than one pack can take was left by a killed process. */
const STALE_LOCK_MS = PACK_TIMEOUT_MS + 60_000;
const POLL_MS = 500;

/** What `vp pack` never reads: its output, installs, tests, the engine's own scenes and docs. */
const NOT_PACKED = new Set(["dist", "node_modules", "__tests__", "scenes", "docs"]);

async function newestSourceMs(dir: string): Promise<number> {
  let newest = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (NOT_PACKED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, await newestSourceMs(path));
    else if (!entry.name.endsWith(".md")) newest = Math.max(newest, (await stat(path)).mtimeMs);
  }
  return newest;
}

/** Whether `dist/` was packed after the last change to the source it is built from. */
export async function packedEngineFresh(): Promise<boolean> {
  if (!existsSync(DIST_ENTRY)) return false;
  return (await stat(DIST_ENTRY)).mtimeMs >= (await newestSourceMs(ENGINE_PACKAGE_DIR));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Takes the pack lock, waiting out another process's pack; false when it outlived a pack. */
async function lock(): Promise<boolean> {
  const deadline = Date.now() + STALE_LOCK_MS;
  for (;;) {
    try {
      await mkdir(LOCK_DIR);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const held = await stat(LOCK_DIR).catch(() => null);
    if (held && Date.now() - held.mtimeMs > STALE_LOCK_MS) {
      await rm(LOCK_DIR, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline) return false;
    await sleep(POLL_MS);
  }
}

/**
 * Packs `@jams/engine` when its `dist/` is missing or older than its source,
 * so an export always bundles the engine as a consumer installs it. `vp run
 * game:build` packs first through its task dependency and finds it fresh;
 * a direct `game build` packs here. One pack at a time across processes.
 * Null when `dist/` is ready, else why it isn't.
 */
export async function ensurePackedEngine(): Promise<string | null> {
  if (!existsSync(join(ENGINE_LINK_DIR, "package.json")))
    return "node_modules/@jams/engine is missing: run `vp install` to link the workspace package";
  if (await packedEngineFresh()) return null;
  if (!(await lock())) return "another engine pack held its lock for too long";
  try {
    if (await packedEngineFresh()) return null;
    const res = spawnSync(existsSync(VP) ? VP : "vp", ["pack"], {
      cwd: ENGINE_PACKAGE_DIR,
      encoding: "utf8",
      timeout: PACK_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0)
      return `packing @jams/engine failed (${res.error?.message ?? `exit ${res.status}`}):\n${res.stdout ?? ""}${res.stderr ?? ""}`;
    return existsSync(DIST_ENTRY) ? null : "packing @jams/engine wrote no dist/index.mjs";
  } finally {
    await rm(LOCK_DIR, { recursive: true, force: true });
  }
}

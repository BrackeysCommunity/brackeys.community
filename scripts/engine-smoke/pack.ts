import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ENGINE = join(REPO, "src/engine");

export type PackageJson = {
  name: string;
  version: string;
  exports: Record<string, string | { types: string; import: string }>;
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  files: string[];
};

export function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}): string {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited ${res.status}\n${String(res.stdout)}\n${String(res.stderr)}`,
    );
  }
  return String(res.stdout);
}

export type Packed = {
  /** The consumer's root: a `package.json` and `node_modules` with the package and its peers. */
  dir: string;
  /** The extracted package, `<dir>/node_modules/@jams/engine`. */
  pkgDir: string;
  pkg: PackageJson;
  tarball: string;
  /** Every path in the tarball, relative to the package root. */
  files: string[];
};

/**
 * Builds `dist`, packs the tarball as the release job does, and
 * extracts it into a fresh directory outside the repo, so nothing resolves
 * through the repo's tsconfig paths or aliases. Dependencies, peers and
 * `tools` (the test tooling a consumer brings) are symlinked from the repo's
 * `node_modules`.
 */
export function packAndExtract(tools: string[] = []): Packed {
  run("vp", ["pack"], { cwd: ENGINE });
  const dir = mkdtempSync(join(tmpdir(), "jams-engine-smoke-"));
  // `bun pm pack` is what the global `vp pm pack` runs here; the repo-local `vp`
  // that scripts and CI get has no `pm` command.
  run("bun", ["pm", "pack", "--destination", dir], { cwd: ENGINE });
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`bun pm pack left no tarball in ${dir}`);
  const tarball = join(dir, tgz);

  const files = run("tar", ["-tzf", tarball])
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace(/^package\//, ""))
    .sort();

  const scope = join(dir, "node_modules/@jams");
  mkdirSync(scope, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", scope]);
  const pkgDir = join(scope, "engine");
  renameSync(join(scope, "package"), pkgDir);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as PackageJson;

  for (const name of [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies),
    ...tools,
  ]) {
    const from = join(REPO, "node_modules", name);
    if (!existsSync(from)) throw new Error(`${name} isn't installed in the repo`);
    const to = join(dir, "node_modules", name);
    mkdirSync(dirname(to), { recursive: true });
    symlinkSync(from, to);
  }
  return { dir, pkgDir, pkg, tarball, files };
}

/** Copies repo files and directories into the consumer directory under the given names. */
export function copyInto(dir: string, paths: Record<string, string>): void {
  for (const [name, from] of Object.entries(paths))
    cpSync(join(REPO, from), join(dir, name), { recursive: true });
}

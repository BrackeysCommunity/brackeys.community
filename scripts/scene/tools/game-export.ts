import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { exportTarget, formatBytes, zipFiles } from "@jams/engine/export";

import { issueLine, usage, type Tool } from "../context";
import { buildGame, targetFlag, ZIP_TARGET } from "./game-build";
import { filesUnder, shownPath } from "./game-manifest";

export type GameExportInput = {
  id?: string;
  zip: boolean;
  /** Default `DEFAULT_ZIP_TARGET`. */
  target?: string;
  /** Default `dist/games/<id>-<target>.zip`. */
  out?: string;
  /** Where the build the zip is made from goes; default `game build`'s. */
  buildOut?: string;
};

export const GAME_EXPORT_USAGE = `game export <id> --zip ${targetFlag(ZIP_TARGET)} [--out dist/games/<id>-<target>.zip]`;

/** Where `game export <id> --zip` writes when `--out` is left out, relative to the working directory. */
export const defaultZipOut = (id: string, target: string) =>
  join("dist", "games", `${id}-${target}.zip`);

/** Builds a project and zips the output (stored, sorted, fixed times); the itch.io target also checks itch.io's layout. */
export const gameExport: Tool<GameExportInput> = async (input, ctx) => {
  if (!input.zip) return usage(GAME_EXPORT_USAGE);
  const { result, built } = await buildGame(
    { id: input.id, target: input.target, out: input.buildOut, allowOverBudget: false },
    ctx,
    "game export",
    ZIP_TARGET,
  );
  if (!built || result.exitCode !== 0) return result;

  const { out, plan } = built;
  const target = plan.manifest.build.target;
  const files = await Promise.all(
    (await filesUnder(out)).map(async (path) => ({
      path,
      bytes: new Uint8Array(await readFile(join(out, path))),
    })),
  );
  const zip = zipFiles(files);
  const file = resolve(input.out ?? defaultZipOut(plan.manifest.game.id, target));
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, zip);
  await rename(tmp, file);

  const layout = exportTarget(target)?.layout;
  const issues = layout ? layout(files.map((f) => ({ path: f.path, bytes: f.bytes.length }))) : [];
  const ok = !issues.some((i) => i.severity === "error");
  const data = result.data as Record<string, unknown>;
  return {
    exitCode: ok ? 0 : 1,
    data: {
      ...data,
      ok,
      zip: file,
      zipBytes: zip.length,
      zipFiles: files.length,
      layoutChecked: layout !== null && layout !== undefined,
      issues: [...((data.issues as unknown[]) ?? []), ...issues],
    },
    text: [
      result.text,
      `wrote ${shownPath(file)}: ${files.length} files, ${formatBytes(zip.length)}${layout ? `; ${target} layout ${ok ? "fits" : "doesn't fit"}` : ""}; nothing uploaded`,
      ...issues.map(issueLine),
    ].join("\n"),
  };
};

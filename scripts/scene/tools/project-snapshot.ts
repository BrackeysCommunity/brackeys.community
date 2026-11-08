import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { formatProjectSnapshot } from "@jams/engine/project";
import { snapshotFiles } from "@jams/engine/vite";

import { failure, type ToolResult } from "../context";
import {
  isHandle,
  loadProject,
  pickProject,
  problemLines,
  type ProjectToolContext,
} from "./project-show";

export type ProjectSnapshotInput = {
  project?: string;
  /** Where to write the snapshot JSON; `-` puts it in the text. Omitted, only the hash is printed. */
  out?: string;
};

/**
 * Pins every live asset of a project by content: docs by the SHA-256 of
 * their canonical text, blobs by their content hash, with this code's
 * schema hashes as the build. Its hash is what a file batch's `base`
 * names. Fails when a live doc doesn't parse or a blob has no hash.
 */
export async function projectSnapshot(
  input: ProjectSnapshotInput,
  ctx: ProjectToolContext,
): Promise<ToolResult> {
  const picked = pickProject(ctx, input.project, "snapshot");
  if (!isHandle(picked)) return picked;
  const loaded = await loadProject(picked);
  const { view, texts, problems } = loaded;
  const project = picked.file.id;

  const missing = [...view.byId.values()].filter((e) => e.sha256 === undefined && !texts.has(e.id));
  if (missing.length > 0) {
    const paths = new Set(missing.map((e) => e.path));
    const why = problems.filter((p) => paths.has(p.path));
    const reasons = missing.map(
      (e) =>
        `"${e.id}" (${e.path}) ${picked.kinds.get(e.kind)?.storage === "doc" ? "doesn't parse, so it has no canonical text" : "has no content hash"}`,
    );
    const result = failure(`${project}: can't pin ${reasons.join("; ")}`, {
      project,
      unparsed: missing.map((e) => e.id),
      problems: why,
    });
    return { ...result, text: [result.text, ...problemLines(why, [])].join("\n") };
  }

  const snapshot = await snapshotFiles({ ...picked, registry: loaded.registry });
  const assets = Object.keys(snapshot.assets).length;
  const data: Record<string, unknown> = { ok: true, project, hash: snapshot.hash, assets };
  if (input.out === undefined)
    return { exitCode: 0, data: { ...data, snapshot }, text: snapshot.hash };
  const text = formatProjectSnapshot(snapshot);
  if (input.out === "-") return { exitCode: 0, data: { ...data, snapshot }, text: text.trimEnd() };
  const file = resolve(input.out);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
  return {
    exitCode: 0,
    data: { ...data, out: file },
    text: `wrote ${file}: ${project} ${assets} asset${assets === 1 ? "" : "s"} ${snapshot.hash}`,
  };
}

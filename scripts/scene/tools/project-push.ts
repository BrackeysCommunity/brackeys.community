import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { readProject } from "@jams/engine/collab";
import {
  ContentStoreError,
  PROJECT_FILE,
  sidecarPathOf,
  type AssetEntry,
  type AssetPath,
  type BlobKindDef,
  type ProjectBundle,
  type ProjectState,
  type Sha256,
} from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";
import type { ProjectProblem as FileProblem } from "@jams/engine/vite";
import * as Y from "yjs";

import { failure, issueLine, plural, usage, type Tool, type ToolContext } from "../context";
import {
  blobContentType,
  fetchHostedBundle,
  HostedError,
  hostedContentStore,
  isHostedUrl,
  putBlob,
  seedHostedBundle,
} from "../hosted";
import { hostedAccess, hostedFailure, ProjectClientError } from "../project-client";
import { discoverProjects, type ProjectHandle } from "../projects";
import { liveEntries, loadProject, problemLines } from "./project-show";

export type ProjectPushInput = {
  /** The project's directory: the one holding its `jams.project.json`. */
  dir?: string;
  url?: string;
  token?: string;
  create?: boolean;
  /** Check the files and read the hosted project as a push does, then report what it would send, sending nothing. */
  dryRun?: boolean;
  timeoutMs?: number;
};

const USAGE = "scene project push <dir> --create --url https://site [--token t] [--dry-run]";

const readOptional = (file: string) =>
  readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });

/** The CLI's project in `dir`, else the one its project file names, its game loaded. */
async function projectIn(ctx: ToolContext, dir: string): Promise<ProjectHandle | null> {
  const found = ctx.projects.find((p) => p.dir === dir);
  if (found) return found;
  const [opened] = await discoverProjects(dir, [PROJECT_FILE]);
  return opened ?? null;
}

export type BundledFiles =
  | {
      ok: true;
      bundle: ProjectBundle;
      /** The live entries the bundle holds a file for. */
      live: AssetEntry[];
      code: ProjectState["code"];
    }
  | { ok: false; problems: FileProblem[]; issues: SceneIssue[]; unread: AssetPath[] };

/**
 * A project's files as `project push` sends them: every live doc as its
 * canonical text, every binary by hash, and the sidecars beside them, with
 * the code map. Refused when a doc doesn't parse or the files have problems
 * the site would refuse too; a binary whose header doesn't read is hosted
 * without meta, as the site seeds it.
 */
export async function bundleFiles(project: ProjectHandle): Promise<BundledFiles> {
  const loaded = await loadProject(project);
  const live = liveEntries(loaded.view);
  const unread = live
    .filter((e) => project.kinds.get(e.kind)?.storage === "doc" && !loaded.texts.has(e.id))
    .map((e) => e.path);
  const problems = loaded.problems.filter((p) => p.issues.some((i) => i.code !== "import-failed"));
  const issues = loaded.view.issues.filter((i) => i.severity === "error");
  if (problems.length > 0 || issues.length > 0 || unread.length > 0)
    return { ok: false, problems, issues, unread };

  const texts: Record<AssetPath, string> = {};
  const blobs: Record<AssetPath, string> = {};
  const sidecars: Record<AssetPath, string> = {};
  const held: AssetEntry[] = [];
  for (const entry of live) {
    const def = project.kinds.get(entry.kind);
    if (def?.storage === "doc") texts[entry.path] = loaded.texts.get(entry.id)!;
    else if (def?.storage === "blob" && entry.sha256 !== undefined)
      blobs[entry.path] = entry.sha256;
    else continue;
    held.push(entry);
    const sidecar = await readOptional(join(project.dir, ...sidecarPathOf(entry.path).split("/")));
    if (sidecar !== null) sidecars[entry.path] = sidecar;
  }
  return {
    ok: true,
    bundle: { project: project.file, texts, blobs, sidecars },
    live: held,
    code: loaded.state.code,
  };
}

/**
 * Seeds a new hosted project from a project's files: its live docs as
 * canonical text, its binaries by hash, its sidecars, its code map and
 * game. The agent token names the project, which the site has reserved
 * empty; one that holds anything already is refused before any upload.
 * Each binary is uploaded first, then the site seeds every doc from the
 * bundle. With `dryRun` the files are checked and the hosted project read
 * as for a push, and the result names the docs it would seed and the
 * binaries it would upload; nothing is sent.
 */
export const projectPush: Tool<ProjectPushInput> = async (input, ctx) => {
  if (!input.dir || !input.url) return usage(USAGE);
  if (!input.create)
    return usage(
      "project push only seeds a new hosted project: pass --create (edit a hosted one with --live)",
    );
  if (!isHostedUrl(input.url)) return usage("--url: the site to host the project, https://…");
  const dir = resolve(input.dir);
  let project: ProjectHandle | null;
  try {
    project = await projectIn(ctx, dir);
  } catch (e) {
    return failure(e instanceof Error ? e.message : String(e));
  }
  if (!project) return failure(`${dir} has no ${PROJECT_FILE}.`);
  const id = project.file.id;

  const files = await bundleFiles(project);
  if (!files.ok) {
    const { problems, issues, unread } = files;
    const result = failure(`${id}: its files can't be hosted as they are; nothing was sent.`, {
      project: id,
      problems,
      issues,
      unread,
    });
    return {
      ...result,
      text: [
        result.text,
        ...problemLines(problems, issues),
        ...unread.map((path) => `  ${path} doesn't parse`),
      ].join("\n"),
    };
  }
  const { bundle, live, code } = files;

  let site;
  try {
    ({ site } = hostedAccess({
      url: input.url,
      ...(input.token === undefined ? {} : { token: input.token }),
      ...(ctx.env ? { env: ctx.env } : {}),
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    }));
  } catch (e) {
    if (e instanceof ProjectClientError)
      return e.exitCode === 2 ? usage(e.message) : failure(e.message);
    throw e;
  }
  const head = { project: id, url: site.origin, dir };

  try {
    const hosted = await fetchHostedBundle(site, id);
    const registry = new Y.Doc();
    Y.applyUpdate(registry, hosted.project);
    const held = Object.keys(readProject(registry).assets).length;
    registry.destroy();
    if (held > 0 || hosted.docs.length > 0)
      return failure(
        `Hosted project "${id}" already exists on ${site.origin}; pull it, or edit it with --live.`,
        { ...head, exists: true },
      );

    const store = hostedContentStore(site, id);
    const toUpload: { entry: AssetEntry; def: BlobKindDef; sha256: Sha256 }[] = [];
    for (const entry of live) {
      const def = project.kinds.get(entry.kind);
      if (def?.storage !== "blob" || entry.sha256 === undefined) continue;
      if (!(await store.has(entry.sha256)))
        toUpload.push({ entry, def: def as BlobKindDef, sha256: entry.sha256 });
    }
    const count = Object.keys(bundle.texts).length + Object.keys(bundle.blobs).length;

    if (input.dryRun) {
      const seeds = Object.keys(bundle.texts).sort();
      return {
        exitCode: 0,
        data: {
          ok: true,
          dryRun: true,
          written: false,
          ...head,
          docs: seeds.length,
          files: count,
          uploaded: 0,
          seeds,
          uploads: toUpload.map(({ entry, def, sha256 }) => ({
            path: entry.path,
            kind: def.kind,
            sha256,
          })),
        },
        text: [
          `would push ${id} to ${site.origin}: ${plural(count, "file")}, ${plural(seeds.length, "doc")}, ${plural(toUpload.length, "upload")}; nothing was sent`,
          ...seeds.map((path) => `  seed ${path}`),
          ...toUpload.map(({ entry }) => `  upload ${entry.path}`),
        ].join("\n"),
      };
    }

    let uploaded = 0;
    for (const { entry, def, sha256 } of toUpload) {
      const bytes = await readFile(join(project.dir, ...entry.path.split("/")));
      await putBlob(store, new Uint8Array(bytes), {
        kind: def.kind,
        contentType: blobContentType(entry.path, def.contentTypes),
        expect: sha256,
      });
      uploaded++;
    }

    const seeded = await seedHostedBundle(site, id, {
      bundle,
      game: project.game?.id ?? null,
      code,
    });
    if (!seeded.ok) {
      const exists = seeded.status === 409;
      const result = failure(
        exists
          ? `Hosted project "${id}" already exists on ${site.origin}.`
          : `The site refused the bundle: ${seeded.message}`,
        { ...head, ...(exists ? { exists } : {}), ...seeded },
      );
      const lines = [
        ...(seeded.problems ?? []).flatMap((p) => [
          `  ${p.path || "(bundle)"}`,
          ...p.issues.map((i) => `  ${issueLine(i)}`),
        ]),
        ...(seeded.issue ? [`  ${issueLine(seeded.issue)}`] : []),
      ];
      return { ...result, text: [result.text, ...lines].join("\n") };
    }
    return {
      exitCode: 0,
      data: {
        ok: true,
        ...head,
        docs: seeded.docs,
        files: count,
        uploaded,
        warnings: seeded.warnings,
      },
      text: `pushed ${id} to ${site.origin}: ${plural(count, "file")}, ${plural(seeded.docs, "doc")}, ${plural(uploaded, "upload")}`,
    };
  } catch (e) {
    if (e instanceof ContentStoreError)
      return {
        ...failure(`The site refused an upload: ${e.message}`, { ...head, issue: e.issue }),
        text: [`error: the site refused an upload`, `  ${issueLine(e.issue)}`].join("\n"),
      };
    const error = e instanceof HostedError ? hostedFailure(e) : e;
    if (error instanceof ProjectClientError) return failure(error.message, head);
    throw e;
  }
};

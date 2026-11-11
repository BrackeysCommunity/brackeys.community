import { mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { readProject } from "@jams/engine/collab";
import {
  docNameOf,
  formatProjectFile,
  parseSidecar,
  PROJECT_FILE,
  SIDECAR_SUFFIX,
  sidecarPathOf,
  type KindEnv,
  type KindRegistry,
  type ProjectId,
} from "@jams/engine/project";
import { createProjectFileAdapter, fileContentStore } from "@jams/engine/vite";
import * as Y from "yjs";

import { prepareLoadedState } from "../../../src/lib/scene/doc-bytes";
import { seedAssetState } from "../../../src/lib/scene/project-bytes";
import { failure, usage, type Tool, type ToolContext, type ToolResult } from "../context";
import {
  fetchHostedBundle,
  HostedError,
  hostedContentStore,
  isHostedUrl,
  type HostedBundle,
  type HostedDoc,
  type HostedSite,
} from "../hosted";
import {
  hostedAccess,
  hostedCodeProject,
  hostedFailure,
  ProjectClientError,
} from "../project-client";
import type { ProjectHandle } from "../projects";

export type ProjectPullInput = {
  /** The hosted project's id. */
  id?: string;
  /** The site hosting it. */
  url?: string;
  /** Its agent token; `JAMS_AGENT_TOKEN` when left out. */
  token?: string;
  /** Where the files go; the CLI project's directory when it has the hosted id. */
  out?: string;
  /** Write nothing; exit 1 when a file would change. */
  check?: boolean;
  timeoutMs?: number;
};

export type PulledChange = { path: string; change: "added" | "changed" | "removed" };

const USAGE =
  "scene project pull <project> --url https://site [--token t] [--out dir] [--check] [--project id]";

const SKIPPED_DIRS = new Set(["node_modules", "dist"]);

/** Every file under `dir`, by project-relative POSIX path; dot and build directories are never walked. */
async function filesUnder(dir: string, keep: (path: string) => boolean) {
  const out = new Map<string, Buffer>();
  async function walk(rel: string) {
    const entries = await readdir(rel ? join(dir, rel) : dir, { withFileTypes: true }).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return [];
        throw e;
      },
    );
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIPPED_DIRS.has(entry.name)) await walk(path);
      } else if (entry.isFile() && keep(path)) out.set(path, await readFile(join(dir, path)));
    }
  }
  await walk("");
  return out;
}

/**
 * The files of `files` a project holds as assets: each one a kind detects,
 * with its sidecar, and each sidecar left without its file. Anything else
 * the asset globs reach (a script beside the art) is not the project's to
 * pull or remove.
 */
function assetFilesOf(files: Map<string, Buffer>, kinds: KindRegistry) {
  const out = new Map<string, Buffer>();
  for (const [path, bytes] of files) {
    if (path.endsWith(SIDECAR_SUFFIX)) {
      if (!files.has(path.slice(0, -SIDECAR_SUFFIX.length))) out.set(path, bytes);
      continue;
    }
    const sidecar = files.get(sidecarPathOf(path));
    const parsed = sidecar === undefined ? null : parseSidecar(sidecar.toString("utf8"));
    let json: unknown;
    if (path.toLowerCase().endsWith(".json")) {
      try {
        json = JSON.parse(bytes.toString("utf8"));
      } catch {
        json = undefined;
      }
    }
    if (kinds.detect(path, json, parsed?.ok ? parsed.sidecar.assetKind : undefined) === null)
      continue;
    out.set(path, bytes);
    if (sidecar !== undefined) out.set(sidecarPathOf(path), sidecar);
  }
  return out;
}

/** A doc's state as the service lays out a seed it hasn't loaded yet. */
function docState(projectId: ProjectId, doc: HostedDoc, project: ProjectHandle): Uint8Array {
  if (doc.state) return doc.state;
  if (doc.prefix === "scene")
    return prepareLoadedState(`${projectId}.${doc.key}`, null, doc.seed).state;
  const env: KindEnv = { registry: project.registry, project: null };
  return seedAssetState({
    project: projectId,
    key: doc.key,
    kind: doc.kind,
    seed: doc.seed,
    kinds: project.kinds,
    env,
  });
}

/**
 * The files a hosted project's bundle becomes, written by the dev server's
 * file adapter into `staging`: each doc's state persisted where the adapter
 * keeps it, each live blob's bytes in its content store, then the registry
 * stored as the adapter writes it back, so each kind's canonical text and
 * every sidecar come out as a checkout's would.
 */
async function stage(
  bundle: HostedBundle,
  project: ProjectHandle,
  site: HostedSite,
  staging: string,
) {
  const dir = join(staging, "files");
  const cacheDir = join(staging, "cache");
  const file = { ...project.file, id: bundle.projectId, name: bundle.name };
  const projectText = formatProjectFile(file);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, PROJECT_FILE), projectText);
  const adapter = createProjectFileAdapter({ ...project, dir, file, cacheDir });

  const projectDoc = new Y.Doc();
  Y.applyUpdate(projectDoc, bundle.project);
  const state = readProject(projectDoc);
  const live = Object.values(state.assets).filter((e) => e.deleted === undefined);
  for (const doc of bundle.docs) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, docState(bundle.projectId, doc, project));
    await adapter.persist(
      docNameOf({ kind: doc.prefix, project: bundle.projectId, key: doc.key }),
      ydoc,
    );
    ydoc.destroy();
  }

  const remote = hostedContentStore(site, bundle.projectId);
  const local = fileContentStore(cacheDir);
  const missing: string[] = [];
  for (const entry of live) {
    if (project.kinds.get(entry.kind)?.storage !== "blob" || entry.sha256 === undefined) continue;
    const bytes = await remote.get(entry.sha256);
    if (bytes === null) missing.push(`${entry.path} (${entry.sha256})`);
    else await local.put(bytes, entry.sha256);
  }
  if (missing.length === 0) await adapter.storeProject(projectDoc);
  projectDoc.destroy();

  const files = await filesUnder(dir, (path) => path !== PROJECT_FILE);
  const skipped = live
    .filter((e) => project.kinds.get(e.kind)?.storage === "doc" && !files.has(e.path))
    .map((e) => e.path)
    .sort();
  return { files, projectText, missing, skipped, watches: (path: string) => adapter.watches(path) };
}

async function writeAtomic(file: string, bytes: Uint8Array) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.pull`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
}

/** Removes the folders `path` leaves empty, up to `root`. */
async function prune(root: string, path: string) {
  const parts = path.split("/").slice(0, -1);
  while (parts.length > 0) {
    try {
      await rmdir(join(root, ...parts));
    } catch {
      return;
    }
    parts.pop();
  }
}

/**
 * Turns a hosted project into files: its bundle (every doc state the
 * service stored and every blob hash) is fetched with the agent token, each
 * doc is formatted here by its kind as the dev server writes it, the blobs
 * are fetched, and the files and sidecars land in `--out`. Every file that
 * changes is reported; `--check` writes nothing and exits 1 when one would.
 * The project file is written only when `--out` has none.
 */
export const projectPull: Tool<ProjectPullInput> = async (input, ctx: ToolContext) => {
  if (!input.id || !input.url) return usage(USAGE);
  if (!isHostedUrl(input.url)) return usage("--url: the site hosting the project, https://…");
  const id = input.id;
  let project: ProjectHandle;
  let site;
  try {
    project = hostedCodeProject(ctx.projects, id, ctx.project);
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
  const local = ctx.projects.find((p) => p.file.id === id);
  if (input.out === undefined && !local)
    return usage(`pass --out: no project of the CLI's is "${id}" to pull into`);
  const out = resolve(input.out ?? local!.dir);
  const head = { project: id, url: site.origin, out, check: input.check === true };

  let bundle: HostedBundle;
  try {
    bundle = await fetchHostedBundle(site, id);
  } catch (e) {
    const error = hostedFailure(e);
    if (error instanceof ProjectClientError) return failure(error.message, head);
    throw e;
  }

  const staging = await mkdtemp(join(tmpdir(), "jams-pull-"));
  try {
    let staged;
    try {
      staged = await stage(bundle, project, site, staging);
    } catch (e) {
      if (e instanceof HostedError) return failure(e.message, head);
      throw e;
    }
    if (staged.missing.length > 0)
      return failure(
        `${id}: the site holds no bytes for ${staged.missing.join(", ")}; nothing was written.`,
        { ...head, missing: staged.missing },
      );

    const current = assetFilesOf(await filesUnder(out, staged.watches), project.kinds);
    const changes: PulledChange[] = [];
    for (const [path, bytes] of staged.files) {
      const had = current.get(path);
      if (!had) changes.push({ path, change: "added" });
      else if (!had.equals(bytes)) changes.push({ path, change: "changed" });
    }
    for (const path of current.keys())
      if (!staged.files.has(path)) changes.push({ path, change: "removed" });
    const projectFile = join(out, PROJECT_FILE);
    const hasProjectFile = await readFile(projectFile).then(
      () => true,
      () => false,
    );
    if (!hasProjectFile) changes.push({ path: PROJECT_FILE, change: "added" });
    changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const write = !input.check && changes.length > 0;
    if (write) {
      for (const { path, change } of changes) {
        const file = join(out, ...path.split("/"));
        if (change === "removed") {
          await rm(file, { force: true });
          await prune(out, path);
        } else if (path === PROJECT_FILE && !staged.files.has(path))
          await writeAtomic(file, new TextEncoder().encode(staged.projectText));
        else await writeAtomic(file, staged.files.get(path)!);
      }
    }

    const verb = input.check ? "would change" : "changed";
    const lines = [
      changes.length === 0
        ? `${id}: ${out} matches the hosted project`
        : `${id}: ${changes.length} ${changes.length === 1 ? "file" : "files"} ${verb} in ${out}`,
      ...changes.map((c) => `  ${c.change.padEnd(7)} ${c.path}`),
      ...staged.skipped.map((p) => `  skipped ${p} (no content on the server yet)`),
    ];
    return {
      exitCode: input.check && changes.length > 0 ? 1 : 0,
      data: {
        ok: true,
        ...head,
        game: bundle.game,
        changes,
        skipped: staged.skipped,
        written: write,
      },
      text: lines.join("\n"),
    } satisfies ToolResult;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};

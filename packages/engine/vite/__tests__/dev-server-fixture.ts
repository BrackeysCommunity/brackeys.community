import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import { readLog } from "../../collab/log";
import type { LogEntry } from "../../collab/types";
import { readFileProject, type FileProject } from "../project-files";

/** The engine's own project, whose files the dev server tests copy. */
export const ENGINE_SCENES = fileURLToPath(new URL("../../scenes/", import.meta.url));

export type ProjectCopy = {
  root: string;
  dir: string;
  cacheDir: string;
  project: FileProject;
  /** A file of the copy, by project-relative path. */
  file(path: string): string;
  read(path: string): Promise<string>;
  /** Deletes the copy, retrying while a write that outlived its test still lands in it. */
  remove(): Promise<void>;
};

/**
 * A temp copy of the engine project holding `paths`, its project file and
 * its materials, which its scenes are judged by; the cache dir sits beside it.
 */
export async function engineProjectCopy(paths: readonly string[]): Promise<ProjectCopy> {
  const root = await mkdtemp(join(tmpdir(), "engine-dev-"));
  const dir = join(root, "engine");
  const cacheDir = join(root, "cache");
  const materials = (await readdir(join(ENGINE_SCENES, "materials")).catch(() => []))
    .filter((f) => f.endsWith(".json"))
    .map((f) => `materials/${f}`);
  for (const path of new Set(["jams.project.json", ...materials, ...paths])) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await copyFile(join(ENGINE_SCENES, path), join(dir, path));
  }
  const project = await readFileProject(dir, { cacheDir });
  const file = (path: string) => join(dir, ...path.split("/"));
  return {
    root,
    dir,
    cacheDir,
    project,
    file,
    read: (path) => readFile(file(path), "utf8"),
    remove: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
  };
}

export async function until(check: () => boolean | Promise<boolean>, what: string, ms = 8_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export type Client = { doc: Y.Doc; provider: HocuspocusProvider; stateless: string[] };

/** A Hocuspocus client on `name`, synced; `clients` collects it so a test can destroy them all. */
export async function connect(
  url: string,
  name: string,
  clients: HocuspocusProvider[],
  doc: Y.Doc = new Y.Doc(),
): Promise<Client> {
  const stateless: string[] = [];
  const provider = new HocuspocusProvider({
    url,
    name,
    document: doc,
    onStateless: ({ payload }) => {
      stateless.push(payload);
    },
  });
  clients.push(provider);
  await until(() => provider.synced, `${name} to sync`);
  return { doc, provider, stateless };
}

export const pushed = (provider: HocuspocusProvider) =>
  until(() => !provider.hasUnsyncedChanges, "the server to acknowledge the update");

/** Every transaction that changes a doc, with the log entries it added. */
export function record(doc: Y.Doc) {
  const seen: { local: boolean; entries: LogEntry[] }[] = [];
  doc.on("afterTransaction", (tr: Y.Transaction) => {
    if (tr.changed.size === 0) return;
    const before = seen.reduce((n, s) => n + s.entries.length, 0);
    const log = readLog(doc);
    seen.push({ local: tr.local, entries: log.slice(Math.min(before, log.length)) });
  });
  return seen;
}

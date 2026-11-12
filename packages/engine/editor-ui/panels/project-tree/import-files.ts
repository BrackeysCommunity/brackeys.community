import {
  assetIdOfPath,
  detectImport,
  isSkippedAssetPath,
  parseAssetDoc,
  suffixedId,
  suffixedPath,
  type AssetId,
  type AssetPath,
  type KindEnv,
  type KindRegistry,
  type ProjectOp,
  type ProjectView,
} from "../../../project/index";
import type { ProjectBlobs } from "../../host";
import { formatBytes } from "../../kit/format";

/** One dropped file the import left out, and why. */
export type SkippedFile = { name: string; reason: string };

/** The ops that import the files that could be read, each with the file it came from. */
export type ImportPlan = { ops: { op: ProjectOp; name: string }[]; skipped: SkippedFile[] };

/**
 * Where an import stands on one file: being read, hashed, sent (`sent` of
 * `total` bytes), or `done` with, planned or skipped.
 */
export type ImportProgress = {
  name: string;
  /** The file's place in the drop, from 0. */
  index: number;
  phase: "read" | "hash" | "upload" | "done";
  sent?: number;
  total?: number;
};

type Report = (phase: ImportProgress["phase"], bytes?: { sent: number; total: number }) => void;

const MAX_SEGMENT = 96;

/** `name` as a file name the project takes: other characters become "-", cut to fit, extension kept. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/-{2,}/g, "-")
    .trim()
    .replace(/^\.+/, "");
  if (cleaned.length <= MAX_SEGMENT) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, MAX_SEGMENT - ext.length) + ext;
}

/** "1 file", "3 files". */
export const filesLabel = (n: number) => (n === 1 ? "1 file" : `${n} files`);

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Reads dropped files into import ops for `folder` ("" or "dir/"): blob
 * kinds are uploaded and become `importAsset`, doc kinds are read as their
 * kind's file and become `createAsset`. A taken path or id gets the
 * `-2`, `-3` suffix the server would give it. Files that aren't an asset
 * of this project, are too large or don't read are skipped with the reason.
 */
export async function planImport({
  files,
  folder,
  view,
  kinds,
  env,
  blobs,
  onProgress,
}: {
  files: readonly File[];
  folder: string;
  view: ProjectView;
  kinds: KindRegistry;
  env: KindEnv;
  blobs: ProjectBlobs;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<ImportPlan> {
  const plan: ImportPlan = { ops: [], skipped: [] };
  const paths = new Set<string>([...view.byPath.keys()].map((p) => p.toLowerCase()));
  const ids = new Set<AssetId>(view.byId.keys());
  const freePath = (path: AssetPath) => {
    let free = path;
    for (let n = 2; paths.has(free.toLowerCase()); n++) free = suffixedPath(path, n);
    return free;
  };
  const freeId = (id: AssetId) => {
    let free = id;
    for (let n = 2; ids.has(free); n++) free = suffixedId(id, n);
    return free;
  };

  for (const [index, file] of files.entries()) {
    const report: Report = (phase, bytes) =>
      onProgress?.({ name: file.name, index, phase, ...bytes });
    report("read");
    await planFile(file, report);
    report("done");
  }
  return plan;

  async function planFile(file: File, report: Report) {
    const skip = (reason: string) => plan.skipped.push({ name: file.name, reason });
    const name = safeFileName(file.name);
    if (!name) {
      skip("Its name has nothing a file name can keep.");
      return;
    }
    const wanted = `${folder}${name}`;
    if (isSkippedAssetPath(wanted)) {
      skip("Schemas, sidecars and project files aren't assets.");
      return;
    }
    const isJson = name.toLowerCase().endsWith(".json");
    let text: string | null = null;
    let json: unknown;
    if (isJson) {
      try {
        text = await file.text();
        json = JSON.parse(text);
      } catch {
        skip("It isn't valid JSON.");
        return;
      }
    }
    const def = detectImport(kinds, wanted, json);
    if (!def) {
      skip("It isn't a kind of file this project takes.");
      return;
    }
    if (def.storage === "code") {
      skip("Code modules come from the game's source.");
      return;
    }
    const path = freePath(wanted);
    const declared =
      def.storage === "doc" && def.idField && json && typeof json === "object"
        ? (json as Record<string, unknown>)[def.idField]
        : undefined;
    const stem = typeof declared === "string" ? declared : assetIdOfPath(path);
    if (!stem) {
      skip("Its name gives no asset id.");
      return;
    }
    if (typeof declared === "string" && ids.has(declared)) {
      skip(`The project already has an asset with the id ${declared}.`);
      return;
    }
    const id = freeId(stem);

    if (def.storage === "blob") {
      if (file.size > def.maxBytes) {
        skip(`A ${def.title.toLowerCase()} is at most ${formatBytes(def.maxBytes)}.`);
        return;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        report("hash");
        const stored = await blobs.upload(bytes, {
          kind: def.kind,
          ...(file.type ? { contentType: file.type } : {}),
          onProgress: (sent, total) => report("upload", { sent, total }),
        });
        plan.ops.push({
          name: file.name,
          op: {
            op: "importAsset",
            path,
            sha256: stored.sha256,
            bytes: stored.bytes,
            kind: def.kind,
            id,
          },
        });
      } catch (err) {
        skip(messageOf(err));
        return;
      }
    } else {
      const read = parseAssetDoc(def, text ?? (await file.text()), env);
      if (!read.ok) {
        skip(read.issues[0]?.message ?? `It isn't a valid ${def.title.toLowerCase()} file.`);
        return;
      }
      plan.ops.push({
        name: file.name,
        op: { op: "createAsset", kind: def.kind, path, id, content: read.value },
      });
    }
    paths.add(path.toLowerCase());
    ids.add(id);
  }
}

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
}: {
  files: readonly File[];
  folder: string;
  view: ProjectView;
  kinds: KindRegistry;
  env: KindEnv;
  blobs: ProjectBlobs;
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

  for (const file of files) {
    const skip = (reason: string) => plan.skipped.push({ name: file.name, reason });
    const name = safeFileName(file.name);
    if (!name) {
      skip("Its name has nothing a file name can keep.");
      continue;
    }
    const wanted = `${folder}${name}`;
    if (isSkippedAssetPath(wanted)) {
      skip("Schemas, sidecars and project files aren't assets.");
      continue;
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
        continue;
      }
    }
    const def = detectImport(kinds, wanted, json);
    if (!def) {
      skip("It isn't a kind of file this project takes.");
      continue;
    }
    if (def.storage === "code") {
      skip("Code modules come from the game's source.");
      continue;
    }
    const path = freePath(wanted);
    const declared =
      def.storage === "doc" && def.idField && json && typeof json === "object"
        ? (json as Record<string, unknown>)[def.idField]
        : undefined;
    const stem = typeof declared === "string" ? declared : assetIdOfPath(path);
    if (!stem) {
      skip("Its name gives no asset id.");
      continue;
    }
    if (typeof declared === "string" && ids.has(declared)) {
      skip(`The project already has an asset with the id ${declared}.`);
      continue;
    }
    const id = freeId(stem);

    if (def.storage === "blob") {
      if (file.size > def.maxBytes) {
        skip(`A ${def.title.toLowerCase()} is at most ${formatBytes(def.maxBytes)}.`);
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const stored = await blobs.upload(bytes, {
          kind: def.kind,
          ...(file.type ? { contentType: file.type } : {}),
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
        continue;
      }
    } else {
      const read = parseAssetDoc(def, text ?? (await file.text()), env);
      if (!read.ok) {
        skip(read.issues[0]?.message ?? `It isn't a valid ${def.title.toLowerCase()} file.`);
        continue;
      }
      plan.ops.push({
        name: file.name,
        op: { op: "createAsset", kind: def.kind, path, id, content: read.value },
      });
    }
    paths.add(path.toLowerCase());
    ids.add(id);
  }
  return plan;
}

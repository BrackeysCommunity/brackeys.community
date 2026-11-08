import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { detectImport, type KindEnv, type ProjectOp } from "@jams/engine/project";

import { failure, usage, type Tool } from "../context";
import { blobContentType, putBlob } from "../hosted";
import { runProjectBatch, type WriterFlags } from "./assets-apply";
import { folderArg } from "./assets-move";
import { settingsArg } from "./assets-set-import";

export type AssetsImportInput = WriterFlags & {
  /** The file on disk to import. */
  file?: string;
  /** Its asset path in the project, or a folder ending in `/`; default the kind's folder. */
  path?: string;
  id?: string;
  kind?: string;
  /** Import settings: a JSON object or `key=value` pairs. */
  settings?: string;
};

const USAGE =
  "scene assets import <file> [--path path|folder/] [--id id] [--kind k] [--settings json] [writer flags]";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Adds a file from disk to a project. A binary's bytes go to the content
 * store first (the dev cache, or with `--live` the dev server's), then
 * `importAsset` names their hash; the file is written to its path with its
 * sidecar and registry entry. A JSON doc kind's file becomes `createAsset`
 * with its content. The kind is told from the name, the JSON's `kind`, or an
 * atlas export's `meta.app` (`detectImport`), unless `--kind` says.
 */
export const assetsImport: Tool<AssetsImportInput> = async (input, ctx) => {
  if (!input.file) return usage(USAGE);
  let data: Uint8Array;
  try {
    data = new Uint8Array(await readFile(input.file));
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT" || (e as { code?: string }).code === "EISDIR")
      return failure(`Not found: ${input.file}.`);
    throw e;
  }
  let settings: Record<string, unknown> | undefined;
  if (input.settings !== undefined) {
    const parsed = settingsArg(input.settings);
    if (!parsed.ok) return parsed.result;
    settings = parsed.set;
  }
  const name = basename(input.file);
  let json: unknown;
  if (name.toLowerCase().endsWith(".json")) {
    try {
      json = JSON.parse(new TextDecoder().decode(data));
    } catch {
      return failure(`${input.file} isn't valid JSON.`);
    }
  }
  let given = input.path?.replace(/^\.?\/+/, "");
  if (given !== undefined && (given === "" || given.endsWith("/")))
    given = `${folderArg(given)}${name}`;

  return runProjectBatch(ctx, input, {
    async build({ project, view, store }) {
      const def =
        input.kind !== undefined
          ? project.kinds.get(input.kind)
          : detectImport(project.kinds, given ?? name, json);
      if (!def)
        return usage(
          input.kind !== undefined
            ? `--kind: no asset kind ${JSON.stringify(input.kind)} in project "${project.file.id}"`
            : `${name}: no asset kind matches its name or content; pass --kind`,
        );
      if (def.storage === "code")
        return usage(`${name} is code (${def.kind}), which lives in git and isn't imported`);
      const env: KindEnv = { registry: project.registry, project: view };
      const path = given ?? `${folderArg(def.defaultFolder?.(env) ?? "")}${name}`;
      const id = input.id === undefined ? {} : { id: input.id };
      let op: ProjectOp;
      if (def.storage === "doc") {
        if (settings) return usage(`--settings is for binary kinds; ${def.kind} is a doc kind`);
        if (!isRecord(json)) return failure(`${input.file}: a ${def.kind} is a JSON object.`);
        op = { op: "createAsset", kind: def.kind, path, ...id, content: json };
      } else {
        const sha256 = await putBlob(store, data, {
          kind: def.kind,
          contentType: blobContentType(path, def.contentTypes),
        });
        op = {
          op: "importAsset",
          path,
          sha256,
          bytes: data.byteLength,
          kind: def.kind,
          ...id,
          ...(settings ? { settings } : {}),
        };
      }
      return { v: 1, label: `Import ${name}`, ops: [op] };
    },
  });
};

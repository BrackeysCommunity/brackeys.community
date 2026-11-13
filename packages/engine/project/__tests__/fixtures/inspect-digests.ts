import { readdirSync, readFileSync } from "node:fs";

import { stableJson } from "../../canonical";
import { sha256 } from "../../hash";
import { atlasKind } from "../../kinds/atlas";
import { audioKind } from "../../kinds/audio";
import type { BlobKindDef, InspectEnv } from "../../kinds/define";
import { fontKind } from "../../kinds/font";
import { recordingKind } from "../../kinds/recording";
import { saveKind } from "../../kinds/save";
import { textureKind } from "../../kinds/texture";

const DIR = new URL("./", import.meta.url);
const FOLDER = "art";

/** Every fixture file, by name, in name order; subfolders hold other tests' fixtures. */
export function fixtureFiles(): string[] {
  return readdirSync(DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.endsWith(".ts") && !name.endsWith(".md"))
    .sort();
}

/** The fixtures as a project folder: each file's path is `art/<name>` and its id is its name's stem. */
export function fixtureEnv(name: string): InspectEnv {
  const ids = new Map(
    fixtureFiles().map((file) => [
      `${FOLDER}/${file}`,
      file
        .replace(/\..*$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-"),
    ]),
  );
  return { path: `${FOLDER}/${name}`, idAt: (path) => ids.get(path) };
}

export const BLOB_KINDS: readonly BlobKindDef[] = [
  textureKind,
  atlasKind,
  fontKind,
  audioKind,
  recordingKind,
  saveKind,
];

/** Settings each kind is inspected with: the defaults and one set that changes something. */
export const SETTINGS: Readonly<Record<string, readonly Record<string, unknown>[]>> = {
  texture: [{}, { filter: "linear", pivot: [0.5, 1], nineSlice: [1, 1, 1, 1] }],
  atlas: [{}, { pivotDefault: [0.5, 1] }, { texture: "items" }],
  font: [{}, { pages: ["texture"] }],
  audio: [{}],
  recording: [{}],
  save: [{}],
};

export type InspectDigest = { ok: boolean; meta: string | null; result: string };

/**
 * Every blob kind over every fixture and each of its settings: the SHA-256
 * of `stableJson(meta)` and of the whole result, keyed `kind|file|settings#`.
 */
export async function inspectDigests(): Promise<Record<string, InspectDigest>> {
  const out: Record<string, InspectDigest> = {};
  for (const name of fixtureFiles()) {
    const bytes = new Uint8Array(readFileSync(new URL(name, DIR)));
    for (const kind of BLOB_KINDS) {
      const variants = SETTINGS[kind.kind] ?? [{}];
      for (const [i, settings] of variants.entries()) {
        const result = kind.inspect(bytes.slice(), settings, fixtureEnv(name));
        out[`${kind.kind}|${name}|${i}`] = {
          ok: result.ok,
          meta: result.ok ? await sha256(stableJson(result.meta)) : null,
          result: await sha256(stableJson(result)),
        };
      }
    }
  }
  return out;
}

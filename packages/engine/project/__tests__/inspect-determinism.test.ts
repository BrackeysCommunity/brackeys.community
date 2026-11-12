import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vite-plus/test";

import { stableJson } from "../canonical";
import { sha256 } from "../hash";
import {
  BLOB_KINDS,
  fixtureEnv,
  fixtureFiles,
  inspectDigests,
  SETTINGS,
  type InspectDigest,
} from "./fixtures/inspect-digests";

const CLI = fileURLToPath(new URL("./fixtures/inspect-digests-cli.ts", import.meta.url));
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("inspection is deterministic", () => {
  it("gives the same meta for the same bytes and settings, run after run", () => {
    for (const name of fixtureFiles()) {
      for (const kind of BLOB_KINDS) {
        for (const settings of SETTINGS[kind.kind] ?? [{}]) {
          const first = kind.inspect(fixture(name), structuredClone(settings), fixtureEnv(name));
          const again = kind.inspect(fixture(name), structuredClone(settings), fixtureEnv(name));
          expect(stableJson(again), `${kind.kind} on ${name}`).toBe(stableJson(first));
        }
      }
    }
  });

  it("reads every fixture as at least one kind, and each kind from at least one fixture", async () => {
    const digests = await inspectDigests();
    const ok = Object.entries(digests).filter(([, d]) => d.ok);
    for (const kind of BLOB_KINDS)
      expect(
        ok.some(([key]) => key.startsWith(`${kind.kind}|`)),
        kind.kind,
      ).toBe(true);
    for (const name of fixtureFiles())
      expect(
        ok.some(([key]) => key.split("|")[1] === name),
        name,
      ).toBe(true);
  });

  it("gives the same sha256(stableJson(meta)) across runs", async () => {
    const first = await inspectDigests();
    expect(await inspectDigests()).toEqual(first);
    const [key, digest] = Object.entries(first).find(([k]) => k.startsWith("texture|texture.png"))!;
    const [, name] = key.split("|");
    const result = BLOB_KINDS[0]!.inspect(fixture(name!), {}, fixtureEnv(name!));
    expect(result.ok && (await sha256(stableJson(result.meta)))).toBe(digest.meta);
  });

  it("gives the same digests under Bun as under Node", async () => {
    expect(process.versions.bun, "this suite runs under Node").toBeUndefined();
    const here = await inspectDigests();
    const { stdout } = await promisify(execFile)("bun", [CLI], {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const bun = JSON.parse(stdout) as {
      runtime: string;
      digests: Record<string, InspectDigest>;
    };
    expect(bun.runtime).toBe("bun");
    expect(Object.keys(bun.digests).sort()).toEqual(Object.keys(here).sort());
    expect(bun.digests).toEqual(here);
  }, 180_000);
});

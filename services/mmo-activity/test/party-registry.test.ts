import { existsSync, readdirSync, statSync } from "node:fs";

import { expect, test } from "vite-plus/test";

import { partyRegistered, versionOf } from "../src/shell/party-registry.ts";
import { familyOf } from "../src/shell/registry.ts";
import { PARTY_DIR, partyFile } from "./party-golden.ts";

const PARTY_SRC = `${import.meta.dirname}/../src/party`;

const vectors = readdirSync(PARTY_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const folders = existsSync(PARTY_SRC)
  ? readdirSync(PARTY_SRC)
      .filter((f) => statSync(`${PARTY_SRC}/${f}`).isDirectory())
      .sort()
  : [];

test("every party folder is a registered version with its vectors", () => {
  for (const id of folders) {
    expect(existsSync(`${PARTY_DIR}/${id}.json`), `${id} has no party vectors`).toBe(true);
    expect(partyRegistered()).toContain(id);
    for (const file of ["index.ts", "model.ts", "scene.ts", "golden.test.ts"])
      expect(existsSync(`${PARTY_SRC}/${id}/${file}`), `src/party/${id}/${file}`).toBe(true);
  }
  expect(partyRegistered()).toEqual(folders);
});

test("a version names the family its vectors are of, and that family has a scene", () => {
  for (const id of partyRegistered()) {
    const v = versionOf(id)!;
    expect(v.id).toBe(id);
    expect(v.family).toBe(partyFile(id).family);
    expect(familyOf(v.family), `${id}'s family ${v.family}`).toBeDefined();
  }
});

// Opt-in: every version the world can draw has a scene.
test.runIf(process.env.MMO_ALL_FAMILIES === "1")("every party vector file has a folder", () => {
  expect(folders).toEqual(vectors);
});

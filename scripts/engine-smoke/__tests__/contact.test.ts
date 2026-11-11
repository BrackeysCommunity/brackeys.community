// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { CONTACT_FLOOR, CONTACT_TICK, judgeContact, readContact } from "../browser/contact";
import { loadRapier } from "../browser/run";
import { REPO } from "../pack";

describe("readContact", () => {
  it("sees the dropped prop's first contact:start against the floor on the pinned tick", async () => {
    const rapier = await loadRapier();
    const read = readContact(rapier);
    expect(read).toEqual({ tick: CONTACT_TICK, other: CONTACT_FLOOR });
    expect(CONTACT_TICK).toBeGreaterThan(0);
    expect(readContact(rapier)).toEqual(read);
  });

  it("reaches the engine only through its public entries, so the packed smoke can run it from the tarball", () => {
    const source = readFileSync(join(REPO, "scripts/engine-smoke/browser/contact.ts"), "utf8");
    const from = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(from.length).toBeGreaterThan(0);
    for (const specifier of from) expect(specifier).toMatch(/^@jams\/engine\//);
  });
});

describe("judgeContact", () => {
  it("passes a start against the floor on the pinned tick", () => {
    expect(judgeContact({ tick: CONTACT_TICK, other: CONTACT_FLOOR })).toBeNull();
  });

  it("fails no read, no start, another tick or another other", () => {
    expect(judgeContact(undefined)).toMatch(/no contact read/);
    expect(judgeContact(null)).toMatch(/no contact:start/);
    expect(judgeContact({ tick: CONTACT_TICK + 1, other: CONTACT_FLOOR })).toMatch(
      new RegExp(`tick ${CONTACT_TICK + 1}, not ${CONTACT_TICK}`),
    );
    expect(judgeContact({ tick: CONTACT_TICK, other: "wall" })).toMatch(/names wall/);
  });
});

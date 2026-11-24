import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import type * as api from "../../mmo-api/src/index.ts";
import { checkProposals, type ProposalsIn, proposalsUse } from "../src/uses/proposals.ts";

const schema = readFileSync(
  new URL("../../../services/mmo-world/sheets/schema/story.arcs.schema.json", import.meta.url),
  "utf8",
);

const kit: api.ArcKit = {
  season: 1,
  templates: ["the-dry-seam"],
  taken: ["raid", "the-dry-seam", "proposed-season-1"],
  when: ["dry-region"],
  effects: ["nothing"],
  schema,
};

const input: ProposalsIn = { kit, ledger: "", season: 1 };

const withId = (id: string) => {
  const { rows } = proposalsUse.stub!(input) as { rows: Record<string, unknown>[] };
  return { rows: [{ ...rows[0], id }] };
};

describe("checkProposals", () => {
  test("refuses an id a trouble already holds", () => {
    const r = checkProposals(input, withId("raid"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad-id");
  });

  test("accepts a fresh id", () => {
    expect(checkProposals(input, withId("a-new-arc")).ok).toBe(true);
  });

  test("the stub steers clear of every taken id", () => {
    const reply = proposalsUse.stub!(input) as { rows: { id: string }[] };
    expect(reply.rows[0].id).toBe("proposed-season-1-2");
    expect(checkProposals(input, reply).ok).toBe(true);
  });
});

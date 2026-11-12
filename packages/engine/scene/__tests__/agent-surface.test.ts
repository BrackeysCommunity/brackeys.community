import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { AGENT_SURFACE_VERSION } from "../agent-surface";

/**
 * The agent lists of `public-api.json` (issue codes, scene and project op names, JSON Schema
 * ids, CLI commands and flags, check kinds, MCP tool names) as of
 * `AGENT_SURFACE_VERSION`. When the lists
 * change, bump the version, update `packages/engine/CHANGELOG.md` under **Agent
 * surface**, and pin the new hash here.
 */
const PINNED = { version: 15, hash: "73cb9e0d1b8b08ad" };

function agentLists() {
  const api = JSON.parse(
    readFileSync(new URL("../../__tests__/public-api.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  const { issueCodes, opNames, projectOpNames, schemaIds, cliCommands, checkKinds, mcpTools } = api;
  return { issueCodes, opNames, projectOpNames, schemaIds, cliCommands, checkKinds, mcpTools };
}

describe("AGENT_SURFACE_VERSION", () => {
  it("is bumped whenever the agent surface changes", () => {
    const hash = createHash("sha256")
      .update(JSON.stringify(agentLists()))
      .digest("hex")
      .slice(0, 16);
    expect(
      { version: AGENT_SURFACE_VERSION, hash },
      "the agent surface changed: bump AGENT_SURFACE_VERSION and re-pin",
    ).toEqual(PINNED);
  });

  it("lists every kind of agent-facing name", () => {
    const lists = agentLists();
    for (const [name, list] of Object.entries(lists))
      expect(Object.keys(list ?? {}).length, name).toBeGreaterThan(0);
  });
});

import { AGENT_SURFACE_VERSION, ISSUE_CODES, type IssueCodeInfo } from "@jams/engine/scene";

import { gameIds, registryOf, type Tool } from "../context";

type CodeTable = Record<string, IssueCodeInfo>;

/** Codes whose hint `codes` prints under its row: what to run when one shows up. */
const HINTED: readonly string[] = ["migration-unresolved"];

/** What `codes` says beside the table, by topic. */
export const CODE_NOTES: Readonly<Record<string, string>> = Object.freeze({
  keys: 'An action\'s 0.x `keys` are deprecated: each key reads as { device: "key", code } for every `KeyboardEvent.code` that `KEY_TO_CODE` (`@jams/engine/game`) gives it, and an unmapped key binds nothing. Declare `bindings` by code instead; `vp run scene input` shows what each action resolves to.',
});

/**
 * The engine's codes, then each game's own (`<game>/<code>`), grouped by
 * owner, with the agent surface version and the notes on deprecated forms.
 */
export const codes: Tool<Record<string, never>> = async (_input, ctx) => {
  const groups: Record<string, CodeTable> = { engine: { ...ISSUE_CODES } };
  for (const id of gameIds(ctx)) {
    const own = Object.entries(registryOf(ctx, id)!.issueCodes).filter(([code]) =>
      code.startsWith(`${id}/`),
    );
    groups[id] = Object.fromEntries(own);
  }
  const width = Math.max(
    ...Object.values(groups).flatMap((g) => Object.keys(g).map((c) => c.length)),
  );
  const text = [`agent surface v${AGENT_SURFACE_VERSION}`]
    .concat(
      Object.entries(groups).flatMap(([owner, table]) => [
        owner,
        ...Object.entries(table).flatMap(([code, info]) => [
          `  ${code.padEnd(width)} ${info.severity.padEnd(5)} ${info.summary}`,
          ...(owner === "engine" && HINTED.includes(code) ? [`    hint: ${info.hint}`] : []),
        ]),
      ]),
    )
    .concat(["notes", ...Object.entries(CODE_NOTES).map(([topic, note]) => `  ${topic}: ${note}`)])
    .join("\n");
  return {
    exitCode: 0,
    data: { agentSurface: AGENT_SURFACE_VERSION, codes: groups, notes: CODE_NOTES },
    text,
  };
};

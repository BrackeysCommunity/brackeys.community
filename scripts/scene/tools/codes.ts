import { AGENT_SURFACE_VERSION, ISSUE_CODES, type IssueCodeInfo } from "@jams/engine/scene";

import { registryOf, type Tool } from "../context";

type CodeTable = Record<string, IssueCodeInfo>;

/** The engine's codes, then each game's own (`<game>/<code>`), grouped by owner, with the agent surface version. */
export const codes: Tool<Record<string, never>> = async (_input, ctx) => {
  const groups: Record<string, CodeTable> = { engine: { ...ISSUE_CODES } };
  for (const id of Object.keys(ctx.games)) {
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
        ...Object.entries(table).map(
          ([code, info]) => `  ${code.padEnd(width)} ${info.severity.padEnd(5)} ${info.summary}`,
        ),
      ]),
    )
    .join("\n");
  return { exitCode: 0, data: { agentSurface: AGENT_SURFACE_VERSION, codes: groups }, text };
};

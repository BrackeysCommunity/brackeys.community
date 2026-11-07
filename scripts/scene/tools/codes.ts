import { ISSUE_CODES } from "@jams/engine/scene";

import type { Tool } from "../context";

export const codes: Tool<Record<string, never>> = async () => {
  const text = Object.entries(ISSUE_CODES)
    .map(([code, info]) => `${code.padEnd(16)} ${info.severity.padEnd(5)} ${info.summary}`)
    .join("\n");
  return { exitCode: 0, data: ISSUE_CODES, text };
};

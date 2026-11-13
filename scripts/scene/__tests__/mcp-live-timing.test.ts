// @vitest-environment node
import { DEFAULT_SWAP_TIMING, SWAP_TIMINGS } from "@jams/engine/game";
import { describe, expect, it } from "vite-plus/test";
import type { z } from "zod";

import { MCP_TOOLS } from "../mcp-tools";

describe("the live tools' timing input", () => {
  const timing = (name: string) =>
    MCP_TOOLS.find((t) => t.name === name)?.input.timing as z.ZodType | undefined;

  it.each(["game_live_publish", "game_live_promote"])(
    "%s takes exactly the engine's timings and names its default",
    (name) => {
      const field = timing(name);
      expect(field).toBeDefined();
      for (const t of SWAP_TIMINGS) expect(field!.safeParse(t).success, t).toBe(true);
      expect(field!.safeParse(undefined).success).toBe(true);
      expect(field!.safeParse("later").success).toBe(false);
      const described = field!.description ?? "";
      for (const t of SWAP_TIMINGS) expect(described).toContain(`\`${t}\``);
      expect(described).toContain(`\`${DEFAULT_SWAP_TIMING}\` (default)`);
    },
  );
});

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { fieldTitle } from "../inspector-model";
import { settingsRows } from "../settings-model";

describe("fieldTitle", () => {
  it("sentence-cases camelCase, kebab-case and snake_case keys", () => {
    expect(fieldTitle("critChance")).toBe("Crit chance");
    expect(fieldTitle("tickRate")).toBe("Tick rate");
    expect(fieldTitle("pixelSnap")).toBe("Pixel snap");
    expect(fieldTitle("end-turn")).toBe("End turn");
    expect(fieldTitle("next_unit")).toBe("Next unit");
    expect(fieldTitle("x")).toBe("X");
  });

  it("keeps acronyms upper-case", () => {
    expect(fieldTitle("aiStepTicks")).toBe("AI step ticks");
    expect(fieldTitle("id")).toBe("ID");
    expect(fieldTitle("maxHP")).toBe("Max HP");
    expect(fieldTitle("URLPath")).toBe("URL path");
  });

  it("titles a settings row from its key when the schema gives none, and keeps meta.title", () => {
    const rows = settingsRows(
      z.object({ aiStepTicks: z.number(), lives: z.number().meta({ title: "Lives per run" }) }),
      { aiStepTicks: 4, lives: 3 },
      "",
    );
    expect(rows.map((r) => r.title)).toEqual(["AI step ticks", "Lives per run"]);
  });
});

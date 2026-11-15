// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { settingsRows } from "../settings-model";

const widgetOf = (field: z.ZodType) => settingsRows(z.object({ field }), {}, "")[0]!.widget;

describe("field meta the inspector reads", () => {
  it("draws a string-key field as text that picks a string key", () => {
    expect(widgetOf(z.string().meta({ widget: "string-key" }))).toMatchObject({
      kind: "text",
      stringKey: true,
    });
    expect(widgetOf(z.string())).not.toHaveProperty("stringKey");
  });

  it("takes a pair's, a range's and a number's step and decimals from meta", () => {
    const pair = z.tuple([z.number(), z.number()]);
    expect(widgetOf(pair.meta({ step: 0.05, decimals: 2 }))).toMatchObject({
      kind: "point",
      step: 0.05,
      bigStep: 0.5,
      decimals: 2,
    });
    expect(widgetOf(pair.meta({ widget: "range", step: 0.05, decimals: 2 }))).toMatchObject({
      kind: "range",
      step: 0.05,
      bigStep: 0.5,
      decimals: 2,
    });
    expect(widgetOf(z.number().meta({ unit: "Hz", step: 1, decimals: 0 }))).toMatchObject({
      kind: "number",
      unit: "Hz",
      step: 1,
      bigStep: 10,
      decimals: 0,
    });
  });

  it("gives a pair with no unit none, so it doesn't read as metres", () => {
    const w = widgetOf(z.tuple([z.number(), z.number()]));
    expect(w).toMatchObject({ kind: "point", pick: false });
    expect(w).not.toHaveProperty("unit");
  });
});

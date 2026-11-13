import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");

describe("the boot status", () => {
  it("starts its headline and its error on one left edge, over the island's centring", () => {
    // `.je-island` centres its children and comes later in the sheet, so the status needs the higher specificity.
    expect(css).toMatch(/\.je-island \{[^}]*align-items: center/);
    const status = /\.je-island\.je-editor-connecting \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(status).toContain("flex-direction: column");
    expect(status).toContain("align-items: flex-start");
  });
});

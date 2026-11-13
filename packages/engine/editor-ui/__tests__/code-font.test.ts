import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

describe("code in the editor", () => {
  it("is set in the editor's mono face at the size of the text around it", () => {
    const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");
    const rule = /:where\(code\):where\(:not\(\.je-host \*\)\) \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("font-family: var(--je-font-mono)");
    expect(rule).toContain("font-size: inherit");
  });
});

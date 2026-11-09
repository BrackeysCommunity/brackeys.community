// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import { showMountFailure } from "../main";

const html = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");

describe("the standalone editor's page", () => {
  it("says the editor is loading before any script runs", () => {
    const page = new DOMParser().parseFromString(html, "text/html");
    expect(page.getElementById("editor")?.textContent?.trim()).toBe("Loading the editor…");
  });

  it("replaces the loading line with why the editor couldn't open", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p class="boot">Loading the editor…</p>';
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Failed to fetch dynamically imported module");
    showMountFailure(root, error);
    expect(root.textContent).toBe(
      "The editor couldn't open: Failed to fetch dynamically imported module",
    );
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(log).toHaveBeenCalledWith("[engine editor] couldn't open", error);
    log.mockRestore();
  });
});

import { describe, expect, test } from "bun:test";

import { parseThemeColor } from "./jam-page.ts";

describe("parseThemeColor", () => {
  test("extracts the host-chosen body background from theme CSS", () => {
    const html =
      "<style>:root{--itchio_ui_bg: #5a4c3a;}body{background-color: #f9b357;}.jam_page_wrap{color: #222222;}</style>";
    expect(parseThemeColor(html)).toBe("#f9b357");
  });

  test("accepts rgb()/rgba() literals", () => {
    expect(parseThemeColor("<style>body{background-color: rgb(34, 34, 34);}</style>")).toBe(
      "rgb(34, 34, 34)",
    );
    expect(parseThemeColor("<style>body{background-color: rgba(34, 34, 34, 0.5)}</style>")).toBe(
      "rgba(34, 34, 34, 0.5)",
    );
  });

  test("returns null when the page has no themed body rule", () => {
    expect(parseThemeColor("<html><body>plain page</body></html>")).toBeNull();
  });

  test("rejects values that are not plain color literals", () => {
    // These would otherwise be interpolated into inline styles on the
    // web app — anything expression-like must be dropped at ingest.
    expect(
      parseThemeColor("<style>body{background-color: url(javascript:alert(1))}</style>"),
    ).toBeNull();
    expect(parseThemeColor("<style>body{background-color: var(--x, red)}</style>")).toBeNull();
  });
});

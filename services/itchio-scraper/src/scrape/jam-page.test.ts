import { describe, expect, test } from "bun:test";

import { deriveStatus, parseThemeColor } from "./jam-page.ts";

describe("deriveStatus", () => {
  // Verbatim class lists off live jam pages — the mapping was previously
  // guessed at and matched none of them, so anything not finished persisted
  // as `upcoming`.
  const base = "view_jam_page view_jam_base_page page_widget base_widget view_jam_default";

  test("maps itch's phase classes to jam status", () => {
    expect(deriveStatus(`${base} before_start has_banner`)).toBe("upcoming");
    expect(deriveStatus(`${base} during_submit has_banner`)).toBe("running");
    expect(deriveStatus(`${base} during_voting has_banner`)).toBe("voting");
    expect(deriveStatus(`${base} after_voting is_over has_banner`)).toBe("over");
  });

  test("reads a finished jam as over, not as still voting", () => {
    // `is_over` pages keep `after_voting` in the list, so phase checks have to
    // run latest-first or every finished jam looks like it is still in voting.
    expect(deriveStatus(`${base} after_voting is_over`)).toBe("over");
  });

  test("falls back to upcoming when no phase class is recognized", () => {
    expect(deriveStatus(base)).toBe("upcoming");
    expect(deriveStatus("")).toBe("upcoming");
  });
});

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

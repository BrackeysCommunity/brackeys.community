import { describe, expect, test } from "bun:test";

import { deriveStatus, parseJamPage, parseThemeColor } from "./jam-page.ts";

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

describe("parseJamPage", () => {
  const modern = (extra = "") => `
    <html><head><title>Cool Jam - itch.io</title></head><body>
    <div class="view_jam_page view_jam_base_page after_voting is_over">
      <h1 class="jam_title_header">Cool Jam</h1>
      <div class="jam_host_header"><a href="https://host.itch.io">Host</a></div>
      <div class="stats_container">
        <div class="stat_box"><div class="stat_value">12</div><div class="stat_label">Entries</div></div>
      </div>
      <div class="jam_content">description</div>
    </div>
    <script>I.ViewJam('#view_jam_1', {"id":4242,"start_date":"2026-01-01 10:00:00","end_date":"2026-01-08 10:00:00"});${extra}</script>
    </body></html>`;

  test("reads a modern jam page", () => {
    const jam = parseJamPage(modern(), "cool-jam");
    expect(jam.jamId).toBe(4242);
    expect(jam.title).toBe("Cool Jam");
    expect(jam.status).toBe("over");
    expect(jam.entriesCount).toBe(12);
    expect(jam.hosts).toEqual([{ name: "Host", url: "https://host.itch.io" }]);
    expect(jam.startsAt?.toISOString()).toBe("2026-01-01T10:00:00.000Z");
  });

  // itch's original jam format (jam ids 1 and 2 are Candy Jam and Cyberpunk
  // Jam): none of the modern furniture is on the page, and the bootstrap
  // payload is the only place the numeric id appears. Discovery can't see
  // these in /jams/past — they reach the scraper via a member's game page.
  const raw = `
    <html><head><title>Candy Jam - itch.io</title></head><body>
    <div id="view_raw_jam_7658739" class="view_raw_jam_page view_jam_base_page">
      <div class="jam_content after_voting is_over">host markup</div>
    </div>
    <script>I.ViewRawJam('#view_raw_jam_7658739', {"start_date":"2014-01-21 14:49:41","end_date":"2014-02-03 07:49:41","status_html":"This jam is now over. <span style=\\"color:{red}\\">ran</span>","voting_end_date":"2014-02-20 11:30:00","id":1});</script>
    </body></html>`;

  test("reads a legacy raw jam page", () => {
    const jam = parseJamPage(raw, "candyjam");
    expect(jam.jamId).toBe(1);
    // No title header — the document title is the only source, minus itch's suffix.
    expect(jam.title).toBe("Candy Jam");
    // Phase classes live on .jam_content, not the page root.
    expect(jam.status).toBe("over");
    expect(jam.startsAt?.toISOString()).toBe("2014-01-21T14:49:41.000Z");
    expect(jam.votingEndsAt?.toISOString()).toBe("2014-02-20T11:30:00.000Z");
    expect(jam.hosts).toEqual([]);
    expect(jam.entriesCount).toBeNull();
  });

  test("reads a bootstrap payload whose strings contain braces", () => {
    // The old `\{[^}]*\}` match stopped at the first brace inside status_html,
    // losing the trailing `"id"` and making the jam unscrapeable.
    expect(parseJamPage(raw, "candyjam").jamId).toBe(1);
    expect(parseJamPage(modern('I.Other("{");'), "cool-jam").jamId).toBe(4242);
  });

  test("throws when the page has neither shape", () => {
    expect(() => parseJamPage("<html><body>nope</body></html>", "ghost")).toThrow(
      /Could not find jam title/,
    );
  });
});

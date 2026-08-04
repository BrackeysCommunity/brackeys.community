import { describe, expect, test } from "bun:test";

import { parseResultsPage } from "./results-page.ts";

/**
 * Trimmed from a real /jam/gmtk-jam-2022/results?page=200 response. The shape
 * that matters: the criterion table is a SIBLING of `.game_summary`, both
 * inside `.game_rank`, and criterion names may be wrapped in links.
 */
const page = `
<div class="game_rank">
  <a class="game_cover" href="https://genyadev.itch.io/basketdice"></a>
  <div class="game_summary">
    <h2><a href="https://genyadev.itch.io/basketdice">BasketDice</a></h2>
    <h3>by <a href="https://genyadev.itch.io">GenyaDev</a></h3>
    <p><a href="/jam/gmtk-jam-2022/rate/1621874" class="forward_link">View submission page</a></p>
  </div>
  <table class="nice_table ranking_results_table">
    <thead><tr><td>Criteria</td><td>Rank</td><td>Score*</td><td>Raw Score</td></tr></thead>
    <tbody>
      <tr><td><a href="/jam/gmtk-jam-2022/results/presentation">Presentation</a></td><td>#3701</td><td>2.400</td><td>3.667</td></tr>
      <tr><td>Overall</td><td>#4038</td><td>2.255</td><td>3.444</td></tr>
    </tbody>
  </table>
</div>
<div class="game_rank">
  <div class="game_summary">
    <h2><a href="https://x.itch.io/controll">Controll</a></h2>
    <p><a href="/jam/gmtk-jam-2022/rate/1621949" class="forward_link">View submission page</a></p>
  </div>
  <table class="nice_table ranking_results_table">
    <thead><tr><td>Criteria</td><td>Rank</td><td>Score*</td><td>Raw Score</td></tr></thead>
    <tbody>
      <tr><td>Top Marks</td><td>#1</td><td>n/a</td><td>n/a</td></tr>
      <tr><td>Overall</td><td>#4038</td><td>2.255</td><td>3.444</td></tr>
    </tbody>
  </table>
</div>
<a class="next_page button" href="?page=201">Next</a>
`;

describe("parseResultsPage", () => {
  test("pairs each game with its sibling criterion table", () => {
    const { games } = parseResultsPage(page);
    expect(games).toHaveLength(2);
    expect(games[0]).toEqual({
      gameId: 1621874,
      gameTitle: "BasketDice",
      results: [
        { criterion: "Presentation", rank: 3701, score: "2.400", rawScore: "3.667" },
        { criterion: "Overall", rank: 4038, score: "2.255", rawScore: "3.444" },
      ],
    });
    expect(games[1]?.gameId).toBe(1621949);
    expect(games[1]?.gameTitle).toBe("Controll");
  });

  test("skips criteria with non-numeric scores", () => {
    const { games } = parseResultsPage(page);
    // "Top Marks" renders as n/a on some jams and carries no usable score.
    expect(games[1]?.results.map((r) => r.criterion)).toEqual(["Overall"]);
  });

  test("reports pagination from the next-page button", () => {
    expect(parseResultsPage(page).hasNext).toBe(true);
    expect(parseResultsPage('<div class="game_rank"></div>').hasNext).toBe(false);
  });

  test("ignores blocks without a rate link or a table", () => {
    expect(
      parseResultsPage('<div class="game_rank"><div class="game_summary"></div></div>').games,
    ).toEqual([]);
    expect(
      parseResultsPage('<div class="game_rank"><a href="/jam/x/rate/5"></a></div>').games,
    ).toEqual([]);
  });

  test("returns nothing for an unrelated page", () => {
    const { games, hasNext } = parseResultsPage("<html><body>429 Too Many Requests</body></html>");
    expect(games).toEqual([]);
    expect(hasNext).toBe(false);
  });
});

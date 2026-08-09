import { describe, expect, test } from "bun:test";

import { mapRawResult, mapResultsResponse } from "./results-json.ts";

/** Trimmed from the real /jam/10205/results.json (GMTK 2019) response. */
const entry = {
  cover_url: "https://img.itch.zone/x.png",
  id: 462807,
  title: "Gooey Castle",
  contributors: [{ id: 1121985, name: "lukeinallcaps" }],
  raw_score: 4.8995433789954,
  rating_count: 73,
  rank: 1,
  url: "https://itch.io/jam/gmtk-2019/rate/462807",
  score: 4.8995433789954,
  criteria: [
    { name: "Design", score: 4.8904109589041, raw_score: 4.8904109589041, rank: 1 },
    { name: "Originality", score: 4.9178082191781, raw_score: 4.9178082191781, rank: 2 },
  ],
};

describe("mapRawResult", () => {
  test("emits the top-level ranking as the Overall row, then criteria", () => {
    expect(mapRawResult(entry)).toEqual([
      { criterion: "Overall", rank: 1, score: "4.900", rawScore: "4.900" },
      { criterion: "Design", rank: 1, score: "4.890", rawScore: "4.890" },
      { criterion: "Originality", rank: 2, score: "4.918", rawScore: "4.918" },
    ]);
  });

  test("itch's computed Overall wins over a host-defined duplicate", () => {
    const rows = mapRawResult({
      id: 1,
      rank: 7,
      score: 3.827,
      raw_score: 3.827,
      criteria: [{ name: "Overall", rank: 8, score: 3.8, raw_score: 3.8 }],
    });
    expect(rows).toEqual([{ criterion: "Overall", rank: 7, score: "3.827", rawScore: "3.827" }]);
  });

  test("skips criteria without usable numbers", () => {
    const rows = mapRawResult({
      id: 1,
      rank: 4038,
      score: 2.255,
      raw_score: 3.444,
      criteria: [{ name: "Top Marks", rank: 1 }],
    });
    expect(rows.map((r) => r.criterion)).toEqual(["Overall"]);
  });
});

describe("mapResultsResponse", () => {
  test("keys games by id", () => {
    const map = mapResultsResponse({ generated_on: 1754700000, results: [entry] });
    expect(map.size).toBe(1);
    expect(map.get(462807)?.gameTitle).toBe("Gooey Castle");
    expect(map.get(462807)?.results).toHaveLength(3);
  });

  test("tolerates an empty or absent results list", () => {
    expect(mapResultsResponse({}).size).toBe(0);
    expect(mapResultsResponse({ results: [] }).size).toBe(0);
  });
});

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { formatScene } from "../format";
import { parseScene, parseSceneOrThrow } from "../parse";
import type { SceneDefinition } from "../types";

const yardText = readFileSync(new URL("../../scenes/test-yard.json", import.meta.url), "utf8");

const messy: SceneDefinition = {
  name: "messy",
  v: 1,
  spawn: [
    [0, 0],
    [100, 0],
  ],
  bounds: [-10, -10, 200, 200],
  cloud: [["box", 5, 5, 4, 1]],
  solid: [
    ["box", 0, 0, 10, 10],
    ["chain", 0, 0, 10, 0, 20, 5],
  ],
  "solid:ice": [],
  entities: [
    { text: "remember", at: [1, 2], b: "note", id: "memo" },
    {
      path: {
        speed: 10,
        mode: "loop",
        pts: [
          [0, 0],
          [10, 0],
        ],
      },
      shape: ["box", 0, 0, 4, 2, 15],
      b: "mover",
      id: "lift",
      name: "Lift",
    },
  ],
};

describe("formatScene", () => {
  it("writes test-yard exactly as committed", () => {
    expect(formatScene(parseSceneOrThrow(yardText)).text).toBe(yardText);
  });

  it("uses fixed key order, one item per line, and drops empty bulk arrays", () => {
    const { text } = formatScene(messy);
    expect(text).toBe(
      [
        "{",
        '  "v": 1,',
        '  "name": "messy",',
        '  "bounds": [-10, -10, 200, 200],',
        '  "spawn": [',
        "    [0, 0],",
        "    [100, 0]",
        "  ],",
        '  "solid": [',
        '    ["box", 0, 0, 10, 10],',
        '    ["chain", 0, 0, 10, 0, 20, 5]',
        "  ],",
        '  "cloud": [',
        '    ["box", 5, 5, 4, 1]',
        "  ],",
        '  "entities": [',
        '    { "id": "memo", "b": "note", "at": [1, 2], "text": "remember" },',
        '    { "id": "lift", "b": "mover", "name": "Lift", "shape": ["box", 0, 0, 4, 2, 15], "path": { "pts": [[0, 0], [10, 0]], "mode": "loop", "speed": 10 } }',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
    expect(formatScene({ ...messy, spawn: [] }).text).toContain('  "spawn": [],\n');
  });

  it("is idempotent through parseScene", () => {
    for (const def of [messy, parseSceneOrThrow(yardText)]) {
      const once = formatScene(def).text;
      const parsed = parseScene(once);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatScene(parsed.def).text).toBe(once);
    }
  });

  it("maps JSON Pointers to lines", () => {
    const { text, lines } = formatScene(messy);
    const rows = text.split("\n");
    const lineOf = (needle: string) => rows.findIndex((r) => r.includes(needle)) + 1;
    expect(lines.get("")).toBe(1);
    expect(lines.get("/bounds")).toBe(4);
    expect(lines.get("/spawn")).toBe(5);
    expect(lines.get("/spawn/1")).toBe(7);
    expect(lines.get("/solid/1")).toBe(lineOf('"chain"'));
    expect(lines.get("/solid/1/3")).toBe(lineOf('"chain"'));
    expect(lines.get("/entities/1")).toBe(lineOf('"lift"'));
    expect(lines.get("/entities/1/path/pts/1")).toBe(lineOf('"lift"'));
    expect(lines.has("/solid:ice")).toBe(false);
  });
});

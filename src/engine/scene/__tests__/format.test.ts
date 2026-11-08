import { describe, expect, it } from "vite-plus/test";

import type { InputScript } from "../../headless/playtest-types";
import type { ChecksFile } from "../checks";
import { comparePointers, formatChecks, formatInputScript, formatScene } from "../format";
import { parseScene, parseSceneOrThrow } from "../parse";
import type { SceneDefinition } from "../types";
import { engine, engineYardText, fake } from "./fixtures/fake-game";

const messy: SceneDefinition = {
  entities: [
    { text: "remember", at: [1, 2], type: "note", id: "memo" },
    {
      speed: 3,
      shape: ["box", 0, 0, 4, 2, 15],
      type: "door",
      id: "gate",
      name: "Gate",
      opens: "zone",
    },
  ],
  settings: { lives: 2, gravity: [0, 900] },
  name: "messy",
  v: 2,
  pad: [["box", 5, 5, 4, 1]],
  bounds: [-10, -10, 200, 200],
  solid: [
    ["box", 0, 0, 10, 10],
    ["chain", 0, 0, 10, 0, 20, 5],
  ],
  "solid:mud": [],
  game: "fake",
};

describe("formatScene", () => {
  it("writes engine-yard exactly as committed", () => {
    expect(formatScene(parseSceneOrThrow(engineYardText, engine)).text).toBe(engineYardText);
  });

  it("uses fixed key order without a registry, one item per line, and drops empty bulk arrays", () => {
    expect(formatScene(messy).text).toBe(
      [
        "{",
        '  "v": 2,',
        '  "game": "fake",',
        '  "name": "messy",',
        '  "bounds": [-10, -10, 200, 200],',
        '  "settings": { "gravity": [0, 900], "lives": 2 },',
        '  "pad": [',
        '    ["box", 5, 5, 4, 1]',
        "  ],",
        '  "solid": [',
        '    ["box", 0, 0, 10, 10],',
        '    ["chain", 0, 0, 10, 0, 20, 5]',
        "  ],",
        '  "entities": [',
        '    { "id": "memo", "type": "note", "at": [1, 2], "text": "remember" },',
        '    { "id": "gate", "type": "door", "name": "Gate", "shape": ["box", 0, 0, 4, 2, 15], "opens": "zone", "speed": 3 }',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("sorts bulk keys by code unit and orders path keys", () => {
    const def: SceneDefinition = {
      v: 1,
      name: "x",
      bounds: [0, 0, 1, 1],
      "solid:b": [["box", 0, 0, 1, 1]],
      solid: [["box", 0, 0, 1, 1]],
      "solid-a": [["box", 0, 0, 1, 1]],
      entities: [
        {
          id: "f",
          type: "follower",
          path: {
            speed: 1,
            pauseMs: 2,
            pts: [
              [0, 0],
              [1, 0],
            ],
            mode: "loop",
          },
          shape: ["box", 0, 0, 1, 1],
        },
      ],
    };
    const { text } = formatScene(def);
    const keys = [...text.matchAll(/^ {2}"([^"]+)"/gm)].map((m) => m[1]);
    expect(keys).toEqual(["v", "name", "bounds", "solid", "solid-a", "solid:b", "entities"]);
    expect(text).toContain(
      '"path": { "pts": [[0, 0], [1, 0]], "mode": "loop", "speed": 1, "pauseMs": 2 }',
    );
  });

  it("is idempotent through parseScene", () => {
    for (const [def, registry] of [
      [messy, fake],
      [parseSceneOrThrow(engineYardText, engine), engine],
    ] as const) {
      const once = formatScene(def).text;
      const parsed = parseScene(once, registry);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatScene(parsed.def).text).toBe(once);
    }
  });

  it("maps JSON Pointers to lines", () => {
    const { text, lines } = formatScene(messy);
    const rows = text.split("\n");
    const lineOf = (needle: string) => rows.findIndex((r) => r.includes(needle)) + 1;
    expect(lines.get("")).toBe(1);
    expect(lines.get("/bounds")).toBe(5);
    expect(lines.get("/settings/gravity/1")).toBe(6);
    expect(lines.get("/pad")).toBe(7);
    expect(lines.get("/solid/1")).toBe(lineOf('"chain"'));
    expect(lines.get("/solid/1/3")).toBe(lineOf('"chain"'));
    expect(lines.get("/entities/1")).toBe(lineOf('"gate"'));
    expect(lines.get("/entities/1/shape/5")).toBe(lineOf('"gate"'));
    expect(lines.has("/solid:mud")).toBe(false);
  });
});

describe("comparePointers", () => {
  it("sorts pointers the way formatScene writes them", () => {
    const pointers = [
      "/entities/10/shape",
      "/entities/2/path/speed",
      "/entities/2/path/pts/1",
      "/entities/2/id",
      "/solid:ice/0",
      "/solid/3",
      "/flag/0/1",
      "/bounds",
      "/v",
      "",
      undefined,
    ];
    const sorted = [...pointers].sort(comparePointers);
    expect(sorted).toEqual([
      "",
      "/v",
      "/bounds",
      "/flag/0/1",
      "/solid/3",
      "/solid:ice/0",
      "/entities/2/id",
      "/entities/2/path/pts/1",
      "/entities/2/path/speed",
      "/entities/10/shape",
      undefined,
    ]);
  });
});

describe("formatInputScript", () => {
  const text = [
    "{",
    '  "$schema": "../input-script.schema.json",',
    '  "v": 1,',
    '  "scene": "yard",',
    '  "at": [10, 20],',
    '  "timeOffsetMs": 500,',
    '  "game": { "push": false },',
    '  "maxTicks": 900,',
    '  "steps": [',
    '    { "for": 30, "hold": ["right"] },',
    '    { "hold": ["left"], "max": 60, "until": { "event": { "entityId": "zone", "type": "sensor:enter" } } },',
    '    { "press": ["jump", "right"] },',
    '    { "wait": 5 }',
    "  ]",
    "}",
    "",
  ].join("\n");

  it("writes the header, then one step per line with sorted keys", () => {
    const script = JSON.parse(text) as Record<string, unknown>;
    const shuffled = Object.fromEntries(Object.entries(script).reverse());
    expect(formatInputScript(shuffled as InputScript)).toBe(text);
    expect(formatInputScript(JSON.parse(text))).toBe(text);
  });

  it("keeps an empty step list on one line", () => {
    expect(formatInputScript({ v: 1, steps: [] } as unknown as InputScript)).toBe(
      '{\n  "v": 1,\n  "steps": []\n}\n',
    );
  });
});

describe("formatChecks", () => {
  const text = [
    "{",
    '  "v": 1,',
    '  "checks": [',
    '    { "id": "valid", "kind": "valid", "max": "warn", "physical": true },',
    '    { "id": "settles", "kind": "reaches", "script": { "v": 1, "steps": [{ "wait": 60 }] }, "result": "script-end" },',
    '    { "id": "from-file", "kind": "reaches", "script": "walk.script.json", "result": "goal" },',
    '    { "id": "touch", "kind": "touches", "atLeast": 1, "entity": "zone" }',
    "  ]",
    "}",
    "",
  ].join("\n");

  it("writes one check per line, its id and kind first", () => {
    const file = JSON.parse(text) as { v: 1; checks: Record<string, unknown>[] };
    const reordered = {
      checks: file.checks.map((c) => Object.fromEntries(Object.entries(c).reverse())),
      v: 1 as const,
    };
    expect(formatChecks(reordered as ChecksFile)).toBe(text);
  });

  it("writes an inline script's keys in the order its own file uses", () => {
    const script = {
      steps: [{ wait: 5 }],
      maxTicks: 900,
      game: { push: false },
      timeOffsetMs: 500,
      at: [10, 20],
      scene: "yard",
      v: 1,
    } as unknown as InputScript;
    const standalone = JSON.parse(formatInputScript(script)) as Record<string, unknown>;
    const file = { v: 1, checks: [{ id: "s", kind: "reaches", result: "script-end", script }] };
    const line = formatChecks(file as ChecksFile).split("\n")[3]!;
    expect(line).toBe(
      '    { "id": "s", "kind": "reaches", "script": { "v": 1, "scene": "yard", "at": [10, 20], "timeOffsetMs": 500, "game": { "push": false }, "maxTicks": 900, "steps": [{ "wait": 5 }] }, "result": "script-end" }',
    );
    const nested = (
      JSON.parse(formatChecks(file as ChecksFile)) as { checks: { script: object }[] }
    ).checks[0]!.script;
    expect(Object.keys(nested)).toEqual(Object.keys(standalone));
  });
});

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import type { InputScript } from "../../headless/playtest-types";
import type { ChecksFile } from "../checks";
import {
  comparePointers,
  formatChecks,
  formatInputScript,
  formatPrefab,
  formatScene,
} from "../format";
import { parseScene, parseSceneOrThrow, pointerLines } from "../parse";
import { parsePrefab } from "../prefab";
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
  v: 3,
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
        '  "v": 3,',
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

describe("formatScene: v3 keys", () => {
  it("writes the assets header on one line after settings, sorted and unique, and drops it empty", () => {
    const def: SceneDefinition = {
      v: 3,
      name: "x",
      bounds: [0, 0, 1, 1],
      groups: { g: { at: [0, 0] } },
      assets: ["zap", "boom", "hud-font", "boom"],
      settings: { gravity: [0, 1] },
    };
    const { text, lines } = formatScene(def);
    expect(text.split("\n").slice(4, 7)).toEqual([
      '  "settings": { "gravity": [0, 1] },',
      '  "assets": ["boom", "hud-font", "zap"],',
      '  "groups": {',
    ]);
    expect(lines.get("/assets")).toBe(6);
    expect(lines.get("/assets/2")).toBe(6);
    expect(formatScene({ ...def, assets: [] }).text).not.toContain('"assets"');
  });

  it("orders z, rot, flip and params among an entity's and an instance's keys", () => {
    const def: SceneDefinition = {
      v: 3,
      name: "x",
      bounds: [0, 0, 1, 1],
      instances: [
        {
          overrides: { "a.z": 1 },
          params: { speed: 1 },
          flip: true,
          rot: 1,
          at: [0, 0],
          z: 2,
          prefab: "p",
          id: "p-1",
        },
      ],
      entities: [{ shape: ["box", 0, 0, 1, 1], z: -1, off: true, type: "solid", id: "s" }],
    };
    const { text } = formatScene(def);
    expect(text).toContain(
      '{ "id": "p-1", "prefab": "p", "z": 2, "at": [0, 0], "rot": 1, "flip": true, "params": { "speed": 1 }, "overrides": { "a.z": 1 } }',
    );
    expect(text).toContain(
      '{ "id": "s", "type": "solid", "off": true, "z": -1, "shape": ["box", 0, 0, 1, 1] }',
    );
  });
});

describe("formatScene: behaviors and grids", () => {
  it("writes behaviors after the other keys, its blocks by name in code-unit order", () => {
    const def: SceneDefinition = {
      v: 3,
      name: "x",
      bounds: [0, 0, 1, 1],
      entities: [
        {
          behaviors: { "zz/late": {}, path: { speed: 2 }, sprite: { id: "a", frame: 1 } },
          zeta: 1,
          at: [0, 0],
          alpha: 2,
          type: "marker",
          id: "m",
        },
      ],
    };
    expect(formatScene(def).text).toContain(
      '{ "id": "m", "type": "marker", "at": [0, 0], "alpha": 2, "zeta": 1, "behaviors": { "path": { "speed": 2 }, "sprite": { "id": "a", "frame": 1 }, "zz/late": {} } }',
    );
  });

  const painted: SceneDefinition = {
    v: 3,
    name: "x",
    bounds: [0, 0, 1, 1],
    entities: [
      { id: "a", type: "marker", at: [0, 0] },
      {
        under: { "0,0": ["2"] },
        cells: { "1,0": ["1*8"], "-1,0": ["0*31,3"], "0,0": ["1*32", "1*32", "0*4,2*24"] },
        behaviors: { glow: { on: true } },
        at: [0, 640],
        empty: {},
        type: "test/paint",
        id: "floor",
      },
      { id: "b", type: "marker", at: [1, 1] },
    ],
  };

  it("spans a grid entity over lines, grid fields last, one chunk per line, keys row-major", () => {
    expect(formatScene(painted).text.split("\n").slice(4, 16)).toEqual([
      '  "entities": [',
      '    { "id": "a", "type": "marker", "at": [0, 0] },',
      '    { "id": "floor", "type": "test/paint", "at": [0, 640], "empty": {}, "behaviors": { "glow": { "on": true } }, "cells": {',
      '      "-1,0": ["0*31,3"],',
      '      "0,0": ["1*32", "1*32", "0*4,2*24"],',
      '      "1,0": ["1*8"]',
      '    }, "under": {',
      '      "0,0": ["2"]',
      "    } },",
      '    { "id": "b", "type": "marker", "at": [1, 1] }',
      "  ]",
      "}",
    ]);
  });

  it("maps chunk pointers to their lines and the rest of the entity to its first line", () => {
    const { text, lines } = formatScene(painted);
    const rows = text.split("\n");
    const lineOf = (needle: string) => rows.findIndex((r) => r.includes(needle)) + 1;
    const first = lineOf('"floor"');
    expect(lines.get("/entities/1")).toBe(first);
    expect(lines.get("/entities/1/at/1")).toBe(first);
    expect(lines.get("/entities/1/behaviors/glow/on")).toBe(first);
    expect(lines.get("/entities/1/cells")).toBe(first);
    expect(lines.get("/entities/1/cells/-1,0")).toBe(first + 1);
    expect(lines.get("/entities/1/cells/0,0/2")).toBe(first + 2);
    expect(lines.get("/entities/1/cells/1,0")).toBe(first + 3);
    expect(lines.get("/entities/1/under")).toBe(first + 4);
    expect(lines.get("/entities/1/under/0,0")).toBe(first + 5);
    expect(lines.get("/entities/2")).toBe(first + 7);
    // The same lines a reader of the text finds.
    expect(new Map([...pointerLines(text)])).toEqual(lines);
  });

  it("orders pointers into behaviors and grids as the text does", () => {
    const pointers = [
      "/entities/1/under/0,0",
      "/entities/1/cells/1,0",
      "/entities/1/cells/-1,0",
      "/entities/1/behaviors/glow",
      "/entities/1/empty",
      "/entities/1/at",
    ];
    expect([...pointers].sort((a, b) => comparePointers(a, b, painted))).toEqual([
      "/entities/1/at",
      "/entities/1/empty",
      "/entities/1/behaviors/glow",
      "/entities/1/cells/-1,0",
      "/entities/1/cells/1,0",
      "/entities/1/under/0,0",
    ]);
  });
});

describe("formatPrefab", () => {
  it("writes the whole header in order, params and overrides one per line, entities last", () => {
    const prefab = {
      entities: [{ id: "top", type: "marker", at: [0, 0] as [number, number] }],
      instances: [
        { id: "b", prefab: "gate", at: [5, 0] as [number, number] },
        { id: "a", prefab: "gate", at: [0, 0] as [number, number], overrides: { "door.z": 1 } },
      ],
      bulk: { solid: [["box", 0, 0, 1, 1]] as never },
      overrides: { "panel.z": 3, "latch/door.path.speed": 30 },
      assets: ["zap", "boom"],
      params: {
        speed: { targets: ["panel.path.speed"], description: "How fast.", default: 60 },
        colour: { description: "Tint.", targets: ["panel.z"] },
      },
      contract: { size: 1 },
      base: "door",
      id: "red-door",
      game: "fake",
      v: 3,
      kind: "prefab" as const,
      $schema: "../prefab.schema.json",
    };
    expect(formatPrefab(prefab)).toBe(
      [
        "{",
        '  "$schema": "../prefab.schema.json",',
        '  "kind": "prefab",',
        '  "v": 3,',
        '  "game": "fake",',
        '  "id": "red-door",',
        '  "base": "door",',
        '  "contract": { "size": 1 },',
        '  "params": {',
        '    "colour": { "description": "Tint.", "targets": ["panel.z"] },',
        '    "speed": { "default": 60, "description": "How fast.", "targets": ["panel.path.speed"] }',
        "  },",
        '  "assets": ["boom", "zap"],',
        '  "overrides": {',
        '    "latch/door.path.speed": 30,',
        '    "panel.z": 3',
        "  },",
        '  "bulk": {',
        '    "solid": [',
        '      ["box", 0, 0, 1, 1]',
        "    ]",
        "  },",
        '  "instances": [',
        '    { "id": "b", "prefab": "gate", "at": [5, 0] },',
        '    { "id": "a", "prefab": "gate", "at": [0, 0], "overrides": { "door.z": 1 } }',
        "  ],",
        '  "entities": [',
        '    { "id": "top", "type": "marker", "at": [0, 0] }',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("leaves empty params, overrides, bulk and instances out but always writes entities", () => {
    expect(
      formatPrefab({
        kind: "prefab",
        v: 3,
        id: "red-door",
        base: "door",
        params: {},
        overrides: {},
        bulk: { solid: [] },
        instances: [],
        entities: [],
      }),
    ).toBe(
      '{\n  "kind": "prefab",\n  "v": 3,\n  "id": "red-door",\n  "base": "door",\n  "entities": []\n}\n',
    );
  });

  it("writes the nested-prefab and variant fixtures exactly as committed", () => {
    for (const name of ["room", "door", "red-gate"]) {
      const text = readFileSync(
        new URL(`./fixtures/prefabs/${name}.json`, import.meta.url),
        "utf8",
      );
      const parsed = parsePrefab(text, engine);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatPrefab(parsed.prefab)).toBe(text);
    }
  });

  it("writes assets after the contract, sorted and unique, and leaves an empty list out", () => {
    const prefab = {
      kind: "prefab" as const,
      v: 3,
      id: "gate",
      assets: ["zap", "boom", "zap"],
      contract: { size: 1 },
      entities: [{ id: "top", type: "marker", at: [0, 0] as [number, number] }],
    };
    expect(formatPrefab(prefab).split("\n").slice(0, 7)).toEqual([
      "{",
      '  "kind": "prefab",',
      '  "v": 3,',
      '  "id": "gate",',
      '  "contract": { "size": 1 },',
      '  "assets": ["boom", "zap"],',
      '  "entities": [',
    ]);
    expect(formatPrefab({ ...prefab, assets: [] })).not.toContain('"assets"');
  });

  it("spans a grid entity over lines", () => {
    const text = formatPrefab({
      kind: "prefab",
      v: 3,
      id: "room",
      entities: [
        { id: "floor", type: "test/paint", at: [0, 0], cells: { "0,0": ["1"] } },
        { id: "top", type: "marker", at: [0, 0] },
      ],
    });
    expect(text).toContain(
      [
        '    { "id": "floor", "type": "test/paint", "at": [0, 0], "cells": {',
        '      "0,0": ["1"]',
        "    } },",
        '    { "id": "top", "type": "marker", "at": [0, 0] }',
      ].join("\n"),
    );
    expect(JSON.parse(text)).toMatchObject({ entities: [{ cells: { "0,0": ["1"] } }, {}] });
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
    '    { "id": "settles", "kind": "reaches", "result": "script-end", "script": { "steps": [{ "wait": 60 }], "v": 1 } },',
    '    { "id": "from-file", "kind": "reaches", "result": "goal", "script": "walk.script.json" },',
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

  it("writes an inline script as one atomic value, its keys by code unit", () => {
    const script = {
      steps: [{ wait: 5 }],
      maxTicks: 900,
      game: { push: false },
      timeOffsetMs: 500,
      at: [10, 20],
      scene: "yard",
      v: 1,
    } as unknown as InputScript;
    const file = { v: 1, checks: [{ script, result: "script-end", kind: "reaches", id: "s" }] };
    const line = formatChecks(file as ChecksFile).split("\n")[3]!;
    expect(line).toBe(
      '    { "id": "s", "kind": "reaches", "result": "script-end", "script": { "at": [10, 20], "game": { "push": false }, "maxTicks": 900, "scene": "yard", "steps": [{ "wait": 5 }], "timeOffsetMs": 500, "v": 1 } }',
    );
  });
});

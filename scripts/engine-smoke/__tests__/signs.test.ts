// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createRegistry, measureText, pxPerMetreOf, withProject } from "@jams/engine/game";
import { createKindRegistry, parseBmfont, projectView, type FontMeta } from "@jams/engine/project";
import { parseSceneOrThrow } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { devAssetUrl } from "../../../packages/engine/editor-ui/connect/dev";
import {
  answerSinkRequest,
  loadSinkProject,
  signFiles,
  type SinkProject,
} from "../browser/project";
import {
  SIGN_BITMAP_PATH,
  SIGN_GRID,
  SIGN_SIZE,
  SIGN_TEXT,
  SIGN_WEB_COLOUR,
  SIGN_WEB_PATH,
  signBmfont,
  signGrid,
  SIGNS,
  signSceneJson,
  type SignFont,
} from "../browser/signs";
import { INSIDE_COLOUR, SINK_PROJECT, SINK_SCENE, SMOKE_BACKGROUND } from "../browser/sink";
import { sinkPrefabs } from "../browser/sink-prefabs";
import { smokeGame } from "../game";
import { REPO } from "../pack";

const SCENES = join(REPO, "packages/engine/scenes");
const FONTS: readonly SignFont[] = ["bitmap", "web"];

let sink: SinkProject;
let files: Record<string, Uint8Array>;

beforeAll(async () => {
  files = await signFiles();
  sink = await loadSinkProject(SCENES, { extra: files });
});

afterAll(() => sink?.close());

function pageSide() {
  const kinds = createKindRegistry(smokeGame);
  const view = projectView(sink.data.state, kinds);
  const values = new Map(Object.entries(sink.data.values));
  const registry = withProject(createRegistry(smokeGame), view, values);
  return { view, values, registry };
}

const fontAt = (path: string) => {
  const entry = pageSide().view.byPath.get(path);
  expect(entry?.kind, path).toBe("font");
  return entry!;
};

describe("the sign run's fonts", () => {
  it("cut every glyph of the bitmap font from crate-0's one-colour square", async () => {
    const font = parseBmfont(signBmfont());
    expect(font?.pages).toEqual(["crates.png"]);
    const atlas = JSON.parse(await readFile(join(SCENES, "art/crates.json"), "utf8")) as {
      frames: { filename: string; frame: { x: number; y: number; w: number; h: number } }[];
    };
    const crate = atlas.frames.find((f) => f.filename === "crate-0")!.frame;
    for (const line of signBmfont()
      .split("\n")
      .filter((l) => l.startsWith("char "))) {
      const n = (k: string) => Number(new RegExp(`\\b${k}=(\\d+)`).exec(line)![1]);
      expect(n("x")).toBeGreaterThanOrEqual(crate.x);
      expect(n("y")).toBeGreaterThanOrEqual(crate.y);
      expect(n("x") + n("width")).toBeLessThanOrEqual(crate.x + crate.w);
      expect(n("y") + n("height")).toBeLessThanOrEqual(crate.y + crate.h);
    }
    for (const c of SIGN_TEXT)
      expect(font?.advances?.[String(c.codePointAt(0))], c).toBeGreaterThan(0);
  });

  it("join the scanned project as fonts: the bitmap one paged on the crates texture, the web one a WOFF2 covering the sign", () => {
    const bitmap = fontAt(SIGN_BITMAP_PATH);
    expect(bitmap.meta?.format).toBe("bmfont");
    expect(bitmap.import?.pages).toEqual([pageSide().view.byPath.get("art/crates.png")?.id]);
    const web = fontAt(SIGN_WEB_PATH);
    expect(web.meta?.format).toBe("woff2");
    const coverage = (web.meta as FontMeta).coverage ?? [];
    for (const c of SIGN_TEXT) {
      const cp = c.codePointAt(0)!;
      expect(
        coverage.some(([from, to]) => cp >= from && cp <= to),
        c,
      ).toBe(true);
    }
    expect(sink.data.state.meta.projectId).toBe(SINK_PROJECT);
  });

  it("are served on the dev route by hash, byte for byte", async () => {
    for (const path of [SIGN_BITMAP_PATH, SIGN_WEB_PATH]) {
      const entry = fontAt(path);
      const res = await answerSinkRequest(sink, {
        method: "GET",
        url: devAssetUrl()(SINK_PROJECT, {
          id: entry.id,
          kind: entry.kind,
          sha256: entry.sha256!,
          bytes: entry.bytes!,
        }),
        headers: {},
      });
      expect(res?.status, path).toBe(200);
      expect(Buffer.from(res!.body as Uint8Array).equals(Buffer.from(files[path]!)), path).toBe(
        true,
      );
    }
  });

  it("go into a scratch copy: the repo's project has neither", async () => {
    for (const path of [SIGN_BITMAP_PATH, SIGN_WEB_PATH])
      await expect(readFile(join(SCENES, path))).rejects.toMatchObject({ code: "ENOENT" });
    const plain = await loadSinkProject(SCENES);
    try {
      const paths = Object.values(plain.data.state.assets).map((e) => e.path);
      expect(paths).not.toContain(SIGN_BITMAP_PATH);
      expect(paths).toContain("art/crates.png");
    } finally {
      await plain.close();
    }
  });
});

describe("the sign scene", () => {
  const fonts = () => ({
    bitmap: fontAt(SIGN_BITMAP_PATH).id,
    web: fontAt(SIGN_WEB_PATH).id,
  });

  it("parses with the project's registry: a text block on each sign naming its font", () => {
    const { registry, view, values } = pageSide();
    const prefabs = sinkPrefabs(view, values, registry);
    const scene = parseSceneOrThrow(signSceneJson(fonts()), registry, {
      prefab: (id) => prefabs.get(id),
    });
    for (const font of FONTS) {
      const entity = scene.entities?.find((e) => e.id === SIGNS[font].entity);
      const text = (entity?.behaviors as Record<string, Record<string, unknown>> | undefined)?.text;
      expect(text, font).toMatchObject({ text: SIGN_TEXT, font: fonts()[font], size: SIGN_SIZE });
    }
    expect(values.has(SINK_SCENE)).toBe(true);
  });

  it("frames each sign with its whole box inside, and reads points inside the box", () => {
    const { registry, view } = pageSide();
    const ppm = pxPerMetreOf(registry);
    for (const font of FONTS) {
      const meta = view.byPath.get(font === "bitmap" ? SIGN_BITMAP_PATH : SIGN_WEB_PATH)!
        .meta as FontMeta;
      const box = measureText([[{ text: SIGN_TEXT }]], meta, SIGN_SIZE);
      expect(box.exact, font).toBe(font === "bitmap");
      const { at, frame } = SIGNS[font];
      const half = { x: box.width / ppm / 2, y: box.height / ppm / 2 };
      expect(at[0] - half.x, font).toBeGreaterThan(frame.minX);
      expect(at[0] + half.x, font).toBeLessThan(frame.maxX);
      expect(at[1] - half.y, font).toBeGreaterThan(frame.minY);
      expect(at[1] + half.y, font).toBeLessThan(frame.maxY);
      const inBox = signGrid(frame).filter(
        (p) => Math.abs(p.x - at[0]) < half.x && Math.abs(p.y - at[1]) < half.y,
      );
      expect(inBox.length, font).toBeGreaterThan(50);
    }
  });

  it("reads a whole grid per sign, and the two frames don't overlap", () => {
    for (const font of FONTS)
      expect(signGrid(SIGNS[font].frame)).toHaveLength(SIGN_GRID[0] * SIGN_GRID[1]);
    expect(SIGNS.bitmap.frame.maxY).toBeLessThan(SIGNS.web.frame.minY);
  });

  it("looks for colours apart from each other and the background", () => {
    const colours = [INSIDE_COLOUR, SIGN_WEB_COLOUR, SMOKE_BACKGROUND];
    expect(new Set(colours).size).toBe(3);
    expect(SIGNS.bitmap.colour).toBe(INSIDE_COLOUR);
  });
});

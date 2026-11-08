import {
  Container,
  Graphics,
  NineSliceSprite,
  Sprite,
  Texture,
  TextureSource,
  TilingSprite,
} from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import { DRAW_LAYERS, type SpriteVisual, type ViewLayerHandle } from "../../context";
import type { Sha256 } from "../../project/types";
import type { SceneLayerDef } from "../../scene/layers";
import type { ShapeObj } from "../../scene/types";
import { createPixiView, pixiContainer, type TextureSource as TextureSource_ } from "../pixi-view";

const box: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 10, hh: 5, rotDeg: 0 };
const style = { fill: 0x112233, stroke: 0xffffff, alpha: 0.5 };

function graphicsOf(view: ReturnType<typeof createPixiView>, id: string): Graphics | undefined {
  for (const layer of view.container.children) {
    const g = layer.children.find((c) => c.label === id);
    if (g) return g as Graphics;
  }
  return undefined;
}

describe("createPixiView", () => {
  it("draws each id once, in a child per layer ordered by DRAW_LAYERS", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, style, "terrain");
    view.draw("b", box, style, "actor");
    view.draw("c", box, style, 35);

    const layers = view.container.children;
    expect(view.container.sortableChildren).toBe(true);
    expect(layers.map((l) => l.zIndex)).toEqual([DRAW_LAYERS.terrain, DRAW_LAYERS.actor, 35]);
    expect(layers.map((l) => l.children.map((c) => c.label))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("replaces a drawing in place and keeps its pose", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, style, "body");
    const g = graphicsOf(view, "a")!;
    view.pose("a", 40, 50, 0.5);
    view.draw("a", { ...box, hw: 20 }, style, "body");

    expect(graphicsOf(view, "a")).toBe(g);
    expect([g.position.x, g.position.y, g.rotation]).toEqual([40, 50, 0.5]);
    expect(g.bounds.width).toBeGreaterThanOrEqual(40);
  });

  it("gives the stroke its own alpha when the style has one", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, { ...style, alpha: 0.2, strokeAlpha: 0.6, strokeWidth: 2 }, "body");
    const painted = graphicsOf(view, "a")!.context.instructions.map((i) => [
      i.action,
      (i.data.style as { alpha: number }).alpha,
    ]);
    expect(painted).toEqual([
      ["fill", 0.2],
      ["stroke", 0.6],
    ]);
  });

  it("moves a redrawn id to its new layer", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, style, "terrain");
    view.draw("a", box, style, "overlay");
    expect(view.container.children.map((l) => l.children.length)).toEqual([0, 1]);
  });

  it("removes idempotently and ignores a pose for an unknown id", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, style, "terrain");
    const g = graphicsOf(view, "a")!;
    view.remove("a");
    view.remove("a");
    view.pose("a", 1, 2);
    expect(g.destroyed).toBe(true);
    expect(graphicsOf(view, "a")).toBeUndefined();
  });

  it("hands out one container per layer for games that draw their own", () => {
    const view = createPixiView(new Container());
    const handle = view.layer("marker");
    const c = pixiContainer(handle);
    expect(c).toBeInstanceOf(Container);
    expect(pixiContainer(view.layer(DRAW_LAYERS.marker))).toBe(c);
    expect(() => pixiContainer({ __viewLayer: true } as ViewLayerHandle)).toThrow();
  });

  it("destroys its visuals and container", () => {
    const container = new Container();
    const view = createPixiView(container);
    view.draw("a", box, style, "terrain");
    const g = graphicsOf(view, "a")!;
    view.destroy();
    expect(g.destroyed).toBe(true);
    expect(container.destroyed).toBe(true);
  });
});

function displayOf(view: ReturnType<typeof createPixiView>, id: string): Container | undefined {
  for (const layer of view.container.children) {
    const d = layer.children.find((c) => c.label === id);
    if (d) return d;
  }
  return undefined;
}

const xyr = (d: Container) => [d.position.x, d.position.y, d.rotation];

describe("interpolation", () => {
  /** A view with `a` posed at (0, 0) in one committed tick and (10, 20, rot) in the next. */
  function twoTicks(rot = 0) {
    const view = createPixiView(new Container());
    view.draw("a", box, style, "body");
    view.pose("a", 0, 0);
    view.commit!(0);
    view.pose("a", 10, 20, rot);
    view.commit!(1);
    return view;
  }
  const frame = (view: ReturnType<typeof createPixiView>, alpha: number) =>
    view.frame!({ alpha, camera: { x: 0, y: 0, zoom: 1 } });

  it("places a visual posed last tick between its two poses by alpha", () => {
    const view = twoTicks();
    frame(view, 0.5);
    expect(xyr(displayOf(view, "a")!)).toEqual([5, 10, 0]);
    frame(view, 1);
    expect(xyr(displayOf(view, "a")!)).toEqual([10, 20, 0]);
  });

  it("doesn't lerp a snapped pose, nor a new visual's first", () => {
    const view = twoTicks();
    view.pose("a", 100, 100, 0, true);
    view.pose("a", 110, 100);
    view.draw("b", box, style, "body");
    view.pose("b", 50, 60);
    view.commit!(2);
    frame(view, 0.5);
    expect(xyr(displayOf(view, "a")!)).toEqual([110, 100, 0]);
    expect(xyr(displayOf(view, "b")!)).toEqual([50, 60, 0]);
  });

  it("leaves a visual not posed in the last tick at its latest pose", () => {
    const view = twoTicks();
    view.commit!(2);
    frame(view, 0.5);
    expect(xyr(displayOf(view, "a")!)).toEqual([10, 20, 0]);
  });

  it("places a pose made since the last commit as is", () => {
    const view = twoTicks();
    view.pose("a", 30, 40);
    frame(view, 0.5);
    expect(xyr(displayOf(view, "a")!)).toEqual([30, 40, 0]);
  });

  it("turns the shorter way round", () => {
    const view = createPixiView(new Container());
    view.draw("a", box, style, "body");
    view.pose("a", 0, 0, Math.PI - 0.1);
    view.commit!(0);
    view.pose("a", 0, 0, -Math.PI + 0.1);
    view.commit!(1);
    frame(view, 0.5);
    expect(Math.abs(Math.abs(displayOf(view, "a")!.rotation) - Math.PI)).toBeLessThan(1e-9);
  });

  it("rounds placed positions to whole canvas pixels with pixelSnap", () => {
    const container = new Container();
    container.scale.set(2);
    container.position.set(0.25, 0.5);
    const view = createPixiView(container, { pixelSnap: true });
    view.draw("a", box, style, "body");
    view.pose("a", 10.3, 4.1);
    frame(view, 1);
    const d = displayOf(view, "a")!;
    // Canvas x = 2 · 10.3 + 0.25 = 20.85 → 21; y = 2 · 4.1 + 0.5 = 8.7 → 9.
    expect([d.position.x, d.position.y]).toEqual([(21 - 0.25) / 2, (9 - 0.5) / 2]);
  });
});

describe("sprites", () => {
  const hash = "a".repeat(64) as Sha256;
  const other = "b".repeat(64) as Sha256;
  const fallback = { shape: box, style };
  const visual = (over: Partial<SpriteVisual> = {}): SpriteVisual => ({
    texture: hash,
    size: [32, 16],
    anchor: [0.5, 1],
    sampling: "linear",
    fallback,
    ...over,
  });

  /** A texture source whose loads the test triggers. */
  function source(initial: Sha256[] = [hash]) {
    const loaded = new Map<Sha256, Texture>();
    const listeners = new Set<(h: Sha256) => void>();
    const make = () => new Texture({ source: new TextureSource({ width: 64, height: 32 }) });
    for (const h of initial) loaded.set(h, make());
    const textures: TextureSource_ = {
      get: (h) => loaded.get(h) ?? null,
      onLoad(cb) {
        listeners.add(cb);
        return () => void listeners.delete(cb);
      },
    };
    return {
      textures,
      listeners,
      base: (h: Sha256) => loaded.get(h)!,
      load(h: Sha256) {
        loaded.set(h, make());
        for (const cb of [...listeners]) cb(h);
      },
    };
  }

  it("sets size, anchor, flips, tint, alpha and blend on the Sprite", () => {
    const src = source();
    const view = createPixiView(new Container(), { textures: src.textures });
    view.sprite!(
      "s",
      visual({
        tint: 0xff0000,
        alpha: 0.4,
        flipX: true,
        blend: "add",
        frame: { x: 16, y: 0, w: 16, h: 8 },
      }),
      "actor",
    );
    const s = displayOf(view, "s") as Sprite;
    expect(s).toBeInstanceOf(Sprite);
    expect(s.texture.frame).toMatchObject({ x: 16, y: 0, width: 16, height: 8 });
    expect(s.texture.source).toBe(src.base(hash).source);
    expect([s.anchor.x, s.anchor.y]).toEqual([0.5, 1]);
    expect([s.scale.x, s.scale.y]).toEqual([-2, 2]);
    expect(s.tint).toBe(0xff0000);
    expect(s.alpha).toBe(0.4);
    expect(s.blendMode).toBe("add");
    expect(s.parent!.zIndex).toBe(DRAW_LAYERS.actor);
  });

  it("caches a frame's texture across sprites and frees it with the last", () => {
    const src = source();
    const view = createPixiView(new Container(), { textures: src.textures });
    const frame = { x: 0, y: 0, w: 8, h: 8 };
    view.sprite!("a", visual({ frame }), "actor");
    view.sprite!("b", visual({ frame }), "actor");
    const t = (displayOf(view, "a") as Sprite).texture;
    expect((displayOf(view, "b") as Sprite).texture).toBe(t);
    view.remove("a");
    expect(t.destroyed).toBe(false);
    view.remove("b");
    expect(t.destroyed).toBe(true);
    expect(src.base(hash).destroyed).toBe(false);
  });

  it("draws tiling and nine-slice sprites at their size", () => {
    const src = source();
    const view = createPixiView(new Container(), { textures: src.textures });
    view.sprite!("t", visual({ tile: true, size: [200, 40], flipY: true }), "terrain");
    view.sprite!("n", visual({ nineSlice: [4, 5, 6, 7], size: [120, 60] }), "overlay");
    const t = displayOf(view, "t") as TilingSprite;
    const n = displayOf(view, "n") as NineSliceSprite;
    expect(t).toBeInstanceOf(TilingSprite);
    expect([t.width, t.height, t.scale.y]).toEqual([200, 40, -1]);
    expect(n).toBeInstanceOf(NineSliceSprite);
    expect([n.width, n.height]).toEqual([120, 60]);
    expect([n.leftWidth, n.topHeight, n.rightWidth, n.bottomHeight]).toEqual([4, 5, 6, 7]);
  });

  it("swaps between a drawing and a sprite under one id, keeping its pose and place", () => {
    const src = source();
    const view = createPixiView(new Container(), { textures: src.textures });
    view.draw("a", box, style, "actor");
    view.draw("z", box, style, "actor");
    view.pose("a", 7, 8, 0.25);
    view.sprite!("a", visual(), "actor");
    const s = displayOf(view, "a")!;
    expect(s).toBeInstanceOf(Sprite);
    expect(xyr(s)).toEqual([7, 8, 0.25]);
    expect(s.parent!.children.map((c) => c.label)).toEqual(["a", "z"]);
    view.draw("a", box, style, "actor");
    expect(displayOf(view, "a")).toBeInstanceOf(Graphics);
    expect(s.destroyed).toBe(true);
    expect(view.container.children.flatMap((l) => l.children).length).toBe(2);
  });

  it("draws the fallback before the texture loads and swaps the sprite in after", () => {
    const src = source([]);
    const view = createPixiView(new Container(), { textures: src.textures });
    view.sprite!("a", visual(), "actor");
    view.pose("a", 3, 4);
    expect(displayOf(view, "a")).toBeInstanceOf(Graphics);
    expect(src.listeners.size).toBe(1);
    src.load(other);
    expect(displayOf(view, "a")).toBeInstanceOf(Graphics);
    src.load(hash);
    const s = displayOf(view, "a")!;
    expect(s).toBeInstanceOf(Sprite);
    expect(xyr(s)).toEqual([3, 4, 0]);
    expect(src.listeners.size).toBe(0);
  });

  it("draws only the fallback for a null texture or a view without textures", () => {
    const src = source();
    const view = createPixiView(new Container(), { textures: src.textures });
    view.sprite!("a", visual({ texture: null }), "actor");
    expect(displayOf(view, "a")).toBeInstanceOf(Graphics);
    expect(src.listeners.size).toBe(0);
    const bare = createPixiView(new Container());
    bare.sprite!("a", visual(), "actor");
    expect(displayOf(bare, "a")).toBeInstanceOf(Graphics);
  });

  it("drops its load subscription on remove and destroy", () => {
    const src = source([]);
    const view = createPixiView(new Container(), { textures: src.textures });
    view.sprite!("a", visual(), "actor");
    view.remove("a");
    expect(src.listeners.size).toBe(0);
    view.sprite!("b", visual(), "actor");
    expect(src.listeners.size).toBe(1);
    view.destroy();
    expect(src.listeners.size).toBe(0);
  });

  it("gives nearest and linear users of one hash separate sources", () => {
    const src = source();
    const view = createPixiView(new Container(), { textures: src.textures });
    view.sprite!("lin", visual(), "actor");
    view.sprite!("near", visual({ sampling: "nearest" }), "actor");
    const lin = (displayOf(view, "lin") as Sprite).texture;
    const near = (displayOf(view, "near") as Sprite).texture;
    expect(lin).toBe(src.base(hash));
    expect(near.source).not.toBe(lin.source);
    expect(near.source.scaleMode).toBe("nearest");
    expect(lin.source.scaleMode).toBe("linear");
    expect(near.source.resource).toBe(lin.source.resource);
    view.destroy();
    expect(near.source.destroyed).toBe(true);
    expect(lin.destroyed).toBe(false);
  });
});

describe("scene layers", () => {
  const layers: SceneLayerDef[] = [
    { name: "back", description: "Far hills.", draw: 2, scroll: [0.5, 0.5] },
    { name: "terrain", description: "Ground.", draw: 0 },
    { name: "world", description: "Actors.", draw: 10, sort: "y" },
    { name: "editor", description: "Helpers.", draw: 60, editorOnly: true },
  ];
  const at = (x: number, y: number) => ({ x, y, zoom: 1 });
  const frame = (view: ReturnType<typeof createPixiView>, camera = at(0, 0)) =>
    view.frame!({ alpha: 1, camera });
  const labels = (c: Container) => c.children.map((child) => child.label);

  it("orders by depth inside a layer, ties by first draw", () => {
    const view = createPixiView(new Container(), { layers });
    for (const id of ["a", "b", "c", "d"]) view.draw(id, box, style, 0);
    view.depth!("a", 2);
    view.depth!("b", 0);
    view.depth!("c", -1);
    view.depth!("d", 0);
    const layer = pixiContainer(view.layer(0));
    layer.sortChildren();
    expect(labels(layer)).toEqual(["c", "b", "d", "a"]);
  });

  it("keeps a visual's depth when a sprite replaces its drawing", () => {
    const hash = "c".repeat(64) as Sha256;
    const texture = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const textures = { get: () => texture, onLoad: () => () => {} };
    const view = createPixiView(new Container(), { layers, textures });
    view.draw("a", box, style, 0);
    view.depth!("a", 3);
    view.sprite!(
      "a",
      {
        texture: hash,
        size: [8, 8],
        anchor: [0.5, 0.5],
        sampling: "linear",
        fallback: { shape: box, style },
      },
      0,
    );
    expect(displayOf(view, "a")).toBeInstanceOf(Sprite);
    expect(displayOf(view, "a")!.zIndex).toBe(3);
  });

  it("sorts a y-sorted layer by (z, interpolated y, first draw) every frame", () => {
    const view = createPixiView(new Container(), { layers });
    for (const [id, y] of [
      ["low", 50],
      ["high", 10],
      ["roof", 90],
      ["twin", 10],
    ] as const) {
      view.draw(id, box, style, 10);
      view.depth!(id, id === "roof" ? 1 : 0);
      view.pose(id, 0, y);
    }
    view.commit!(0);
    const layer = pixiContainer(view.layer(10));
    expect(layer.sortableChildren).toBe(false);
    frame(view);
    expect(labels(layer)).toEqual(["high", "twin", "low", "roof"]);

    view.pose("high", 0, 70);
    view.commit!(1);
    view.frame!({ alpha: 0.25, camera: at(0, 0) });
    expect(labels(layer)).toEqual(["twin", "high", "low", "roof"]);
    frame(view);
    expect(labels(layer)).toEqual(["twin", "low", "high", "roof"]);
  });

  it("moves a scroll [0.5, 0.5] layer half as far as the camera, others not at all", () => {
    const view = createPixiView(new Container(), { layers });
    view.draw("hill", box, style, 2);
    view.draw("rock", box, style, 0);
    view.draw("plain", box, style, 35);
    frame(view, at(200, -80));
    const back = pixiContainer(view.layer(2));
    expect([back.position.x, back.position.y]).toEqual([100, -40]);
    expect(pixiContainer(view.layer(0)).position.x).toBe(0);
    expect(pixiContainer(view.layer(35)).position.x).toBe(0);
    // On screen the layer moves by camera · scroll: world shift 200 − offset 100.
    frame(view, at(300, -80));
    expect(back.position.x).toBe(150);
  });

  it("hides an entity's visual on an editor-only layer unless editing", () => {
    let editing = false;
    const view = createPixiView(new Container(), { layers, editing: () => editing });
    view.draw("note", box, style, 60);
    view.depth!("note", 0);
    view.draw("ghost", box, style, 60);
    expect(displayOf(view, "note")!.visible).toBe(false);
    expect(displayOf(view, "ghost")!.visible).toBe(true);
    editing = true;
    frame(view);
    expect(displayOf(view, "note")!.visible).toBe(true);
    editing = false;
    frame(view);
    expect(displayOf(view, "note")!.visible).toBe(false);
  });

  it("draws at numeric orders no layer has, and at named draw layers", () => {
    const view = createPixiView(new Container(), { layers });
    view.draw("a", box, style, "actor");
    view.draw("b", box, style, 35);
    expect(view.container.children.map((l) => l.zIndex)).toEqual([DRAW_LAYERS.actor, 35]);
    expect(pixiContainer(view.layer("actor")).sortableChildren).toBe(true);
  });
});

import {
  Container,
  Graphics,
  Matrix,
  NineSliceSprite,
  ParticleContainer,
  RenderTexture,
  Sprite,
  Texture,
  TextureSource,
  TilingSprite,
} from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import { DRAW_LAYERS, type SpriteVisual, type ViewLayerHandle } from "../../context";
import type { EmitterFile } from "../../project/kinds/emitter";
import type { Sha256 } from "../../project/types";
import type { SceneLayerDef } from "../../scene/layers";
import type { ShapeObj } from "../../scene/types";
import {
  createPixiView,
  createViewportSurface,
  pixiContainer,
  type SurfaceRenderer,
  type TextureSource as TextureSource_,
} from "../pixi-view";

const box: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 0.1, hh: 0.05, rotDeg: 0 };
const style = { fill: 0x112233, stroke: 0xffffff, alpha: 0.5 };

/** The default px per metre: a view draws metres in world px inside its container. */
const PPM = 100;

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
    view.pose("a", 0.4, 0.5, 0.5);
    view.draw("a", { ...box, hw: 0.2 }, style, "body");

    expect(graphicsOf(view, "a")).toBe(g);
    expect([g.position.x, g.position.y, g.rotation]).toEqual([40, 50, 0.5]);
    expect(g.bounds.width).toBeGreaterThanOrEqual(40);
    expect(view.container.scale.x).toBe(1 / PPM);
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

/** A display's pose in metres: its world px over the view's px per metre. */
const xyr = (d: Container) => [d.position.x / PPM, d.position.y / PPM, d.rotation];

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
    // The camera's world container: 2 canvas px per world px, 200 per metre.
    const world = new Container();
    world.scale.set(2 * PPM);
    world.position.set(0.25, 0.5);
    const container = new Container();
    world.addChild(container);
    const view = createPixiView(container, { pixelSnap: true });
    view.draw("a", box, style, "body");
    view.pose("a", 0.103, 0.041);
    frame(view, 1);
    const d = displayOf(view, "a")!;
    // Canvas x = 200 · 0.103 + 0.25 = 20.85 → 21; y = 200 · 0.041 + 0.5 = 8.7 → 9.
    expect(d.position.x).toBeCloseTo((21 - 0.25) / 2, 9);
    expect(d.position.y).toBeCloseTo((9 - 0.5) / 2, 9);
    expect(d.getGlobalPosition().x).toBeCloseTo(21, 9);
    expect(d.getGlobalPosition().y).toBeCloseTo(9, 9);
  });
});

describe("sprites", () => {
  const hash = "a".repeat(64) as Sha256;
  const other = "b".repeat(64) as Sha256;
  const fallback = { shape: box, style };
  const visual = (over: Partial<SpriteVisual> = {}): SpriteVisual => ({
    texture: hash,
    size: [0.32, 0.16],
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
    view.sprite!("t", visual({ tile: true, size: [2, 0.4], flipY: true }), "terrain");
    view.sprite!("n", visual({ nineSlice: [4, 5, 6, 7], size: [1.2, 0.6] }), "overlay");
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
        size: [0.08, 0.08],
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
    frame(view, at(2, -0.8));
    const back = pixiContainer(view.layer(2));
    // World px: half the camera's 200, −80 px from the origin.
    expect([back.position.x, back.position.y]).toEqual([100, -40]);
    expect(pixiContainer(view.layer(0)).position.x).toBe(0);
    expect(pixiContainer(view.layer(35)).position.x).toBe(0);
    // On screen the layer moves by camera · scroll: world shift 200 − offset 100.
    frame(view, at(3, -0.8));
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

  it("offsets the scroll layers for another viewport's camera without moving the visuals", () => {
    const view = createPixiView(new Container(), { layers });
    view.draw("hill", box, style, 2);
    view.pose("hill", 1, 1);
    view.commit!(0);
    frame(view, at(2, -0.8));
    const back = pixiContainer(view.layer(2));
    view.parallax({ x: 6, y: 0 });
    expect([back.position.x, back.position.y]).toEqual([300, 0]);
    expect(displayOf(view, "hill")!.position.x).toBe(100);
    view.parallax({ x: 2, y: -0.8 });
    expect([back.position.x, back.position.y]).toEqual([100, -40]);
  });

  it("shows only the named layers, hiding draw orders no layer names, until shown all again", () => {
    const view = createPixiView(new Container(), { layers });
    view.draw("rock", box, style, 0);
    view.draw("hill", box, style, 2);
    view.draw("odd", box, style, 35);
    view.showLayers(["terrain"]);
    expect(pixiContainer(view.layer(0)).visible).toBe(true);
    expect(pixiContainer(view.layer(2)).visible).toBe(false);
    expect(pixiContainer(view.layer(35)).visible).toBe(false);
    // A layer made later follows the same list.
    view.draw("actor", box, style, 10);
    expect(pixiContainer(view.layer(10)).visible).toBe(false);
    view.showLayers(null);
    for (const order of [0, 2, 35, 10]) expect(pixiContainer(view.layer(order)).visible).toBe(true);
  });

  it("draws at numeric orders no layer has, and at named draw layers", () => {
    const view = createPixiView(new Container(), { layers });
    view.draw("a", box, style, "actor");
    view.draw("b", box, style, 35);
    expect(view.container.children.map((l) => l.zIndex)).toEqual([DRAW_LAYERS.actor, 35]);
    expect(pixiContainer(view.layer("actor")).sortableChildren).toBe(true);
  });
});

describe("px per metre", () => {
  const hash = "d".repeat(64) as Sha256;
  const texture = new Texture({ source: new TextureSource({ width: 48, height: 24 }) });
  const textures = { get: () => texture, onLoad: () => () => {} };
  const layers: SceneLayerDef[] = [
    { name: "far", description: "Hills.", draw: 2, scroll: [0.5, 0.25] },
  ];

  /**
   * One scene's visuals in `k` world px per unit: `k = 100` is its metric form
   * at the default px per metre, `k = 1` its px form, which a view at one px
   * per metre draws exactly as the px-only view did.
   */
  function drawScene(pxPerMetre: number, k: number) {
    // The camera's world container, mapping world units to canvas px.
    const world = new Container();
    world.scale.set(1.5 * k);
    world.position.set(-12.25, 40.5);
    const view = createPixiView(world.addChild(new Container()), {
      textures,
      layers,
      pxPerMetre,
    });
    const u = (px: number) => px / k;
    const fallback = { shape: box, style };
    view.draw(
      "box",
      { type: "box", cx: u(10), cy: u(-6), hw: u(25), hh: u(7.5), rotDeg: 30 },
      style,
      0,
    );
    view.draw("disc", { type: "circle", cx: u(3), cy: u(4), r: u(18) }, style, 10);
    view.pose("disc", u(123.4), u(-56.75), 0.3);
    const sprite = (size: [number, number], over: Partial<SpriteVisual> = {}): SpriteVisual => ({
      texture: hash,
      size: [u(size[0]), u(size[1])],
      anchor: [0.25, 1],
      sampling: "nearest",
      fallback,
      ...over,
    });
    view.sprite!("crate", sprite([72, 36], { flipX: true }), 10);
    view.pose("crate", u(880), u(1140));
    view.sprite!("floor", sprite([200, 48], { tile: true }), 0);
    view.pose("floor", u(-64), u(320), 0.5);
    view.sprite!("panel", sprite([120, 60], { nineSlice: [4, 5, 6, 7] }), 10);
    view.pose("panel", u(400.5), u(12.25));
    view.draw(
      "hill",
      { type: "capsule", cx: 0, cy: u(30), r: u(12), halfLen: u(40), rotDeg: 0 },
      style,
      2,
    );
    view.commit!(0);
    view.frame!({ alpha: 1, camera: { x: u(333), y: u(-41), zoom: 1 } });
    return view;
  }

  const ids = ["box", "disc", "crate", "floor", "panel", "hill"];

  it("at 100 px per metre puts every display object where its px form drew it", () => {
    const metric = drawScene(100, 100);
    const px = drawScene(1, 1);
    for (const id of ids) {
      const a = displayOf(metric, id)!.getBounds();
      const b = displayOf(px, id)!.getBounds();
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(a[key] - b[key]), `${id}.${key}`).toBeLessThan(1e-6);
      }
      const pa = displayOf(metric, id)!.getGlobalPosition();
      const pb = displayOf(px, id)!.getGlobalPosition();
      expect(Math.abs(pa.x - pb.x), id).toBeLessThan(1e-6);
      expect(Math.abs(pa.y - pb.y), id).toBeLessThan(1e-6);
    }
    const nine = displayOf(metric, "panel") as NineSliceSprite;
    expect([nine.leftWidth, nine.width, nine.height]).toEqual([4, 120, 60]);
  });

  it("at 32 px per metre draws a 1 m box 32 world px wide, its stroke still 1 px", () => {
    const view = createPixiView(new Container(), { pxPerMetre: 32 });
    view.draw("cell", { type: "box", cx: 0.5, cy: 0.5, hw: 0.5, hh: 0.5, rotDeg: 0 }, style, 0);
    view.pose("cell", 2, 1);
    const g = displayOf(view, "cell") as Graphics;
    expect([g.position.x, g.position.y]).toEqual([64, 32]);
    const stroke = g.context.instructions.find((i) => i.action === "stroke")!;
    expect((stroke.data.style as { width: number }).width).toBe(1);
    // The outline is traced in world px; the stroke only adds its own px around it.
    expect(g.getLocalBounds().width).toBeGreaterThanOrEqual(32);
    expect(g.getLocalBounds().width).toBeLessThan(34);
    expect(view.container.scale.x).toBe(1 / 32);
  });
});

describe("viewport surfaces", () => {
  it("draws the world into a texture of its rect's size, shown in a sprite at its corner", () => {
    const surface = createViewportSurface(true);
    surface.layout({ x: 960, y: 0, width: 960, height: 540.4 }, 2);
    expect([surface.display.position.x, surface.display.position.y]).toEqual([960, 0]);
    const sprite = surface.display.children.find((c) => c.label === "viewport-texture") as Sprite;
    const texture = sprite.texture as RenderTexture;
    expect(texture).toBeInstanceOf(RenderTexture);
    expect([texture.width, texture.height, texture.source.resolution]).toEqual([960, 540, 2]);
    const calls: Parameters<SurfaceRenderer["render"]>[0][] = [];
    const world = new Container();
    const transform = new Matrix().translate(5, 6);
    surface.render({ render: (o) => void calls.push(o) }, world, transform, 0x101010);
    expect(calls).toEqual([
      { container: world, target: texture, transform, clear: true, clearColor: 0x101010 },
    ]);
    surface.destroy();
    expect(surface.display.destroyed).toBe(true);
  });

  it("draws a border inside the rect, and nothing to draw for the stage's own viewport", () => {
    const surface = createViewportSurface(false);
    surface.layout({ x: 0, y: 0, width: 200, height: 100 }, 1, { width: 4, color: 0xff0000 });
    const border = surface.display.children.find((c) => c.label === "viewport-border") as Graphics;
    const bounds = border.getLocalBounds();
    expect([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]).toEqual([0, 0, 200, 100]);
    expect(surface.display.children.some((c) => c.label === "viewport-texture")).toBe(false);
    const calls: unknown[] = [];
    surface.render({ render: (o) => void calls.push(o) }, new Container(), new Matrix(), 0);
    expect(calls).toEqual([]);
    surface.layout({ x: 0, y: 0, width: 200, height: 100 }, 1);
    expect(border.getLocalBounds().maxX).toBe(0);
  });
});

describe("SceneView.particles", () => {
  const preset: EmitterFile = {
    kind: "emitter",
    v: 1,
    rate: 0,
    bursts: [{ atMs: 0, count: 2 }],
    lifeMs: [1000, 1000],
    speed: [0, 0],
    angle: [0, 0],
  };
  const sceneLayers: SceneLayerDef[] = [
    { name: "back", description: "", draw: 2 },
    { name: "gameplay", description: "", draw: 12 },
  ];
  const particlesIn = (c: Container) =>
    c.children
      .filter((k): k is ParticleContainer => k instanceof ParticleContainer)
      .reduce((n, k) => n + k.particleChildren.length, 0);

  it("is null for a view made without particles", () => {
    expect(createPixiView(new Container()).particles?.()).toBeNull();
  });

  it("gives one layer: emitters on their own layer, bursts on gameplay, in world px", () => {
    const view = createPixiView(new Container(), {
      layers: sceneLayers,
      pxPerMetre: 50,
      particles: { reducedMotion: false, seed: "s" },
    });
    const layer = view.particles!()!;
    expect(view.particles!()).toBe(layer);
    layer.emitter("e", { ...preset }, () => ({ x: 1, y: 2, rot: 0 }), 2);
    layer.burst({ ...preset }, { x: 3, y: 0 }, { count: 5 });
    layer.update(16);
    const back = pixiContainer(view.layer(2));
    const gameplay = pixiContainer(view.layer(12));
    expect([particlesIn(back), particlesIn(gameplay)]).toEqual([2, 5]);
    const drawn = back.children.find((k) => k instanceof ParticleContainer)!;
    expect((drawn as ParticleContainer).particleChildren[0]).toMatchObject({ x: 50, y: 100 });
    view.destroy();
    expect(layer.stats()).toEqual({ emitters: 0, particles: 0 });
  });

  it("draws a preset's texture once it loads, squares until then", () => {
    const hash = "a".repeat(64) as Sha256;
    const loaded = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    let ready = false;
    const textures: TextureSource_ = {
      get: (h) => (ready && h === hash ? loaded : null),
      onLoad: () => () => {},
    };
    const view = createPixiView(new Container(), {
      textures,
      particles: {
        reducedMotion: false,
        seed: "s",
        texture: () => ({ hash, sampling: "linear" }),
      },
    });
    const layer = view.particles!()!;
    layer.emitter("e", { ...preset }, () => ({ x: 0, y: 0, rot: 0 }));
    layer.update(16);
    const holder = pixiContainer(view.layer(DRAW_LAYERS.body));
    const pc = holder.children.find((k) => k instanceof ParticleContainer) as ParticleContainer;
    expect(pc.texture).toBe(Texture.WHITE);
    ready = true;
    layer.update(16);
    expect(pc.texture.source).toBe(loaded.source);
    expect(pc.particleChildren.every((p) => p.texture === pc.texture)).toBe(true);
    view.destroy();
  });
});

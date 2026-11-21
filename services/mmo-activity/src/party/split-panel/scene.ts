import "../../scenes/rewire/scene.css";
import "./scene.css";
import { Unseen } from "../../api.ts";
import { geometry, land, pick } from "../../scenes/rewire/scene.ts";
import {
  PICKUP,
  board,
  distance,
  glyph,
  letter,
  pieceColour,
  pointers,
  set,
  svg,
  text,
  type Point,
  type Size,
} from "../../shell/board.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { plural } from "../../units.ts";
import { glimpsed } from "../seats.ts";
import { PartyBar, familyHost, seatName } from "../wrap.ts";
import { MARK, UNLIT, wiresSeat, type SplitPanelModel } from "./model.ts";

// How far a press may wander and still be a tap.
const TAP_PX = 8;

/** A colour as a seat names it out loud: its number, as well as its swatch. */
export function colourName(c: number): string {
  return `colour ${c + 1}`;
}

/** The colours a ports seat reads, each with the glyph of the port it goes to. */
export function legend(code: number[] | undefined): { colour: number; glyph: number }[] {
  return (code ?? []).flatMap((g, colour) => (g === Unseen ? [] : [{ colour, glyph: g }]));
}

interface Drag {
  wire: number;
  from: Point;
  p: Point;
}

/** The wires seat's colours to drag, and the ports seat's glyphs and lit port. */
export function mount(host: PartySceneHost): Scene {
  const merged = () => host.model as SplitPanelModel;
  const layout = host.layout;
  const n = layout.size;
  const shape = layout.shape ?? 0;
  const plugger = wiresSeat(host.seat);
  // A glimpse of the next seat's part adds what it shows to this seat's own.
  const more = host.glimpse;
  const key = glimpsed(layout.key, more?.key);
  const marks = glimpsed(layout.glyph, more?.glyph);
  const reads = legend(glimpsed(layout.code, more?.code));
  // A colour is drawn only where it was dealt: a wire not this seat's is plain.
  const colourOf = (w: number) => {
    const c = key?.[w];
    return c === undefined || c === Unseen ? undefined : c;
  };

  const inner = familyHost(host, { model: () => merged(), mine: () => true });
  const view = board(
    inner,
    plugger
      ? `A panel of ${plural(n, "wire")}. You see the colours of your own wires; call them out and plug each into the port a ports seat lights for it.`
      : `A panel of ${plural(n, "port")}. You see each port's glyph and which glyph some colours go to; when a colour is called, light its port.`,
  );
  const bar = new PartyBar(host, plugger ? "You hold wires." : "You read ports.");
  const root = view.root;

  let size: Size = { width: 0, height: 0 };
  let geo = geometry(n, { width: 1, height: 1 }, shape);
  let cables: SVGPathElement[] = [];
  let plugs: SVGGElement[] = [];
  let ports: SVGRectElement[] = [];
  let lights: SVGTextElement[] = [];
  let drag: Drag | undefined;
  let chosen: number | undefined;

  function swatch(c: number, at: Point, r: number): SVGGElement {
    const tag = text("tag", at.x, at.y, String(c + 1));
    set(tag, { "font-size": r * 0.9 });
    return svg(
      "g",
      { class: "swatch", "aria-label": colourName(c) },
      svg("circle", { cx: at.x, cy: at.y, r, fill: pieceColour(c) }),
      tag,
    );
  }

  function build(): void {
    const { r } = geo;
    ports = geo.marks.map((at, p) => {
      const port = svg("rect", {
        class: "port",
        x: at.x - r,
        y: at.y - r,
        width: r * 2,
        height: r * 2,
      });
      root.append(port);
      const g = marks?.[p];
      if (g !== undefined && g !== Unseen) root.append(glyph(g, at, r * 0.55, "var(--ash)"));
      else root.append(text("tag", at.x, at.y, letter(p)));
      return port;
    });
    lights = geo.marks.map((at) => {
      const t = text("light-tag", at.x - r * 1.5, at.y - r * 0.9);
      root.append(t);
      return t;
    });
    root.append(...geo.seats.map((s) => svg("circle", { class: "seat", cx: s.x, cy: s.y, r })));
    cables = [];
    plugs = [];
    for (let w = 0; w < n; w++) {
      const c = colourOf(w);
      const stroke = c === undefined ? "var(--concrete)" : pieceColour(c);
      const s = geo.sources[w]!;
      root.append(svg("circle", { class: "source", cx: s.x, cy: s.y, r: geo.sr, stroke }));
      if (c !== undefined) root.append(swatch(c, s, geo.sr * 0.6));
      cables.push(svg("path", { class: "cable", stroke, "stroke-width": Math.max(5, r * 0.3) }));
      const plug = svg(
        "g",
        {
          class: "plug",
          "aria-label":
            c === undefined ? `Wire ${letter(w)}` : `Wire ${letter(w)}, ${colourName(c)}`,
        },
        svg("circle", { r: r * 0.86, stroke }),
        text("tag", 0, 0, letter(w)),
      );
      plugs.push(plug);
    }
    root.append(...cables, ...plugs);
    // A ports seat's reading: each colour it holds and the glyph it goes to.
    const row = Math.min(r * 2.2, (size.height - 16) / Math.max(1, reads.length));
    const x = size.width / 2;
    for (const [i, { colour, glyph: g }] of reads.entries()) {
      const y = 8 + row * (i + 0.5);
      root.append(
        svg(
          "g",
          { class: "reading" },
          swatch(colour, { x: x - r * 1.1, y }, r * 0.7),
          glyph(g, { x: x + r * 1.1, y }, r * 0.55, "var(--ash)"),
        ),
      );
    }
  }

  function plugAt(w: number): Point {
    return drag?.wire === w ? drag.p : geo.seats[merged().at[w]!]!;
  }

  function frame(): void {
    const now = view.fit();
    if (now) {
      size = now;
      geo = geometry(n, size, shape);
      build();
    }
    const m = merged();
    for (let w = 0; w < n; w++) {
      const s = geo.sources[w]!;
      const p = plugAt(w);
      set(cables[w]!, { d: `M${s.x},${s.y}L${p.x},${p.y}` });
      const mine = m.holds(host.seat, w);
      set(plugs[w]!, {
        transform: `translate(${p.x} ${p.y})`,
        class: `plug${drag?.wire === w || chosen === w ? " held" : ""}${plugger && !mine ? " theirs" : ""}`,
      });
    }
    const by = ports.map(() => [] as number[]);
    for (const [s, port] of m.mark.entries()) if (port !== UNLIT) by[port]?.push(s);
    for (const [p, port] of ports.entries()) {
      set(port, { class: by[p]!.length > 0 ? "port lit" : "port" });
      const line = by[p]!.map((s) => String(s + 1)).join(" ");
      if (lights[p]!.textContent !== line) lights[p]!.textContent = line;
    }
  }

  function plugIn(wire: number, port: number): void {
    if (merged().at[wire] !== port) inner.move(wire, port);
  }

  const unbind = pointers(inner.surface, {
    down(p) {
      if (!plugger) {
        const { port } = land(geo, p);
        const near = port ?? land({ ...geo, seats: geo.marks }, p).port;
        if (near !== undefined) inner.move(0, near, MARK);
        return false;
      }
      if (chosen !== undefined) {
        const { port } = land(geo, p);
        const wire = chosen;
        chosen = undefined;
        if (port !== undefined) plugIn(wire, port);
        return false;
      }
      const m = merged();
      const wire = pick(geo, m.at, p);
      if (wire === undefined || !m.holds(host.seat, wire)) return false;
      drag = { wire, from: p, p };
      root.append(plugs[wire]!);
      return true;
    },
    move(p) {
      if (drag) drag.p = p;
    },
    up(p, ev) {
      if (!drag) return;
      const { wire, from } = drag;
      drag = undefined;
      if (distance(from, p) <= TAP_PX) {
        chosen = wire;
        return;
      }
      const { port, miss } = land(geo, p);
      inner.dropped(miss, geo.r * PICKUP, port !== undefined, ev);
      if (port !== undefined) plugIn(wire, port);
    },
    cancel() {
      drag = undefined;
    },
  });

  function line(m: SplitPanelModel): string {
    if (!plugger) {
      const lit = m.mark[host.seat]!;
      return lit === UNLIT ? "Light the port for a called colour" : `You lit port ${letter(lit)}`;
    }
    const lit = m.mark.flatMap((port, s) =>
      port === UNLIT ? [] : [`${seatName(s)}: ${letter(port)}`],
    );
    return lit.length > 0 ? `Lit · ${lit.join(", ")}` : "Call your colours out";
  }

  return {
    frame() {
      frame();
      bar.fit();
      const m = merged();
      bar.say(line(m));
      for (let s = 0; s < host.seats; s++) bar.light(s, m.mark[s] !== UNLIT);
    },
    destroy() {
      unbind();
      view.remove();
      bar.remove();
    },
  };
}

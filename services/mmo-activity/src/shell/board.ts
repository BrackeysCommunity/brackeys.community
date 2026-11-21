import { beacon } from "../beacon.ts";

/** The least radius, in CSS px, a piece is hit within: a thumb's. */
export const HIT = 22;
/** A piece is picked up, and a drop lands, from this many radii away. */
export const PICKUP = 1.6;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

const SVG = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number>;

/** One SVG element, built in a line. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  set(node, attrs);
  node.append(...children);
  return node;
}

/** Sets attributes, touching the DOM only where a value changed. */
export function set(node: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    const next = String(v);
    if (node.getAttribute(k) !== next) node.setAttribute(k, next);
  }
}

/** The play area in CSS px. Scenes lay out in these, so a hit radius is a real one. */
export function sizeOf(surface: HTMLElement): Size {
  const r = surface.getBoundingClientRect();
  return { width: Math.max(1, r.width), height: Math.max(1, r.height) };
}

/** A pointer's place on the surface. */
export function pointIn(surface: HTMLElement, ev: { clientX: number; clientY: number }): Point {
  const r = surface.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The nearest of some points, and how far it is. */
export function nearest(points: Point[], p: Point): { index: number; distance: number } {
  let best = { index: -1, distance: Infinity };
  for (const [index, q] of points.entries()) {
    const d = distance(p, q);
    if (d < best.distance) best = { index, distance: d };
  }
  return best;
}

export interface Gesture {
  /** A pointer went down. Return false to let it pass. */
  down(p: Point, ev: PointerEvent): boolean | void;
  move?(p: Point, ev: PointerEvent): void;
  up?(p: Point, ev: PointerEvent): void;
  /** The system took the pointer away: drop whatever was held. */
  cancel?(): void;
}

/**
 * One pointer at a time on the surface, captured so a drag that leaves it
 * still ends on it, and a cancel that drops the drag. Returns the unbind.
 */
export function pointers(surface: HTMLElement, g: Gesture): () => void {
  let held: number | undefined;
  const down = (ev: PointerEvent) => {
    if (held !== undefined || g.down(pointIn(surface, ev), ev) === false) return;
    held = ev.pointerId;
    try {
      surface.setPointerCapture?.(ev.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured.
    }
    ev.preventDefault();
  };
  const move = (ev: PointerEvent) => {
    if (ev.pointerId === held) g.move?.(pointIn(surface, ev), ev);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== held) return;
    held = undefined;
    g.up?.(pointIn(surface, ev), ev);
  };
  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== held) return;
    held = undefined;
    g.cancel?.();
  };
  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerup", up);
  surface.addEventListener("pointercancel", cancel);
  return () => {
    surface.removeEventListener("pointerdown", down);
    surface.removeEventListener("pointermove", move);
    surface.removeEventListener("pointerup", up);
    surface.removeEventListener("pointercancel", cancel);
  };
}

/** Records how far a drop missed its mark, for sizing pieces on real phones. */
export function dropped(
  family: string,
  missPx: number,
  hitPx: number,
  landed: boolean,
  ev: PointerEvent,
): void {
  beacon("drop", {
    family,
    missPx: Math.round(missPx),
    hitPx: Math.round(hitPx),
    landed,
    pointer: ev.pointerType,
  });
}

/** The colours pieces are told apart by, from the pack's palette. Never the only signal. */
export const PIECES = 9;

export function pieceColour(i: number): string {
  return `var(--piece-${((i % PIECES) + PIECES) % PIECES})`;
}

/** A piece's letter: A, B, C… */
export function letter(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

// Twelve marks that read apart without colour, each in a box from -1 to 1.
const GLYPHS: { name: string; d: string; fill: boolean }[] = [
  { name: "circle", d: "M0,-0.8A0.8,0.8 0 1 1 0,0.8A0.8,0.8 0 1 1 0,-0.8Z", fill: true },
  { name: "square", d: "M-0.7,-0.7H0.7V0.7H-0.7Z", fill: true },
  { name: "triangle", d: "M0,-0.85L0.85,0.7H-0.85Z", fill: true },
  { name: "diamond", d: "M0,-0.9L0.75,0L0,0.9L-0.75,0Z", fill: true },
  { name: "cross", d: "M-0.7,-0.7L0.7,0.7M0.7,-0.7L-0.7,0.7", fill: false },
  { name: "bars", d: "M-0.7,-0.45H0.7M-0.7,0.45H0.7", fill: false },
  { name: "ring", d: "M0,-0.75A0.75,0.75 0 1 1 0,0.75A0.75,0.75 0 1 1 0,-0.75Z", fill: false },
  { name: "chevron", d: "M-0.7,0.5L0,-0.5L0.7,0.5", fill: false },
  { name: "plus", d: "M0,-0.8V0.8M-0.8,0H0.8", fill: false },
  { name: "zigzag", d: "M-0.8,0.4L-0.3,-0.5L0.3,0.4L0.8,-0.5", fill: false },
  { name: "half", d: "M0,-0.8A0.8,0.8 0 0 1 0,0.8Z", fill: true },
  { name: "bolt", d: "M0.2,-0.9L-0.5,0.1H0L-0.2,0.9L0.5,-0.1H0Z", fill: true },
];

export function glyphName(i: number): string {
  return GLYPHS[i % GLYPHS.length]!.name;
}

/** Glyph i drawn about a point at a radius, in a colour. */
export function glyph(i: number, at: Point, r: number, colour: string): SVGPathElement {
  const g = GLYPHS[i % GLYPHS.length]!;
  return svg("path", {
    d: g.d,
    transform: `translate(${at.x} ${at.y}) scale(${r})`,
    fill: g.fill ? colour : "none",
    stroke: colour,
    "stroke-width": g.fill ? 0 : 0.28,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-label": g.name,
  });
}

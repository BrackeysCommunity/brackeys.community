import { qVector } from "./quantize";

/**
 * An on-screen control. `at` and `radius` are fractions of the canvas's
 * shorter side, from its top-left corner.
 */
export type TouchControlDef =
  | {
      id: string;
      kind: "button";
      action: string;
      at: [x: number, y: number];
      radius: number;
      label?: string;
    }
  | { id: string; kind: "stick"; action: string; at: [x: number, y: number]; radius: number }
  | { id: string; kind: "dpad"; action: string; at: [x: number, y: number]; radius: number };

/** What a control reports: a button's state, or a stick's or d-pad's position in the unit disc. */
export type TouchControlValue = { down: boolean } | { x: number; y: number };

export type TouchControls = {
  /** Shows or hides the overlay; hiding releases every held control. */
  show(on: boolean): void;
  /** Releases every held control and removes the overlay and its listeners. */
  destroy(): void;
  /**
   * The id of the shown control under a page point (`clientX`, `clientY`),
   * else null. A touch that starts there belongs to the control, not the pointer.
   */
  hitTest(clientX: number, clientY: number): string | null;
};

/** Inside this fraction of a d-pad's radius no direction is held. */
const DPAD_CENTER = 0.3;

const keyOf = (value: TouchControlValue): string =>
  "down" in value ? String(value.down) : `${value.x},${value.y}`;

type Held = { def: TouchControlDef; node: HTMLElement; knob: HTMLElement | null; last: string };

/**
 * Draws `controls` as a DOM overlay filling `host` (the canvas's frame) and
 * reports each control's value to `sink` whenever it changes. Stick and
 * d-pad values are clamped to the unit disc and quantised; y grows downward.
 */
export function createTouchControls(
  host: HTMLElement,
  controls: readonly TouchControlDef[],
  sink: (control: string, value: TouchControlValue) => void,
): TouchControls {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  // The overlay is positioned against the host, so an unpositioned host becomes relative until destroy.
  const position = win?.getComputedStyle(host).position ?? "";
  const restorePosition = position === "" || position === "static" ? host.style.position : null;
  if (restorePosition !== null) host.style.position = "relative";

  const root = doc.createElement("div");
  root.dataset.touchControls = "";
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    userSelect: "none",
    webkitUserSelect: "none",
    // cqmin is the overlay's shorter side, the unit `at` and `radius` are fractions of.
    containerType: "size",
    zIndex: "1",
  } satisfies Partial<CSSStyleDeclaration>);

  const nodes = new Map<
    string,
    { def: TouchControlDef; node: HTMLElement; knob: HTMLElement | null }
  >();
  for (const def of controls) {
    const node = doc.createElement("div");
    node.dataset.touchControl = def.id;
    node.dataset.kind = def.kind;
    Object.assign(node.style, {
      position: "absolute",
      left: `calc(${def.at[0] - def.radius} * 100cqmin)`,
      top: `calc(${def.at[1] - def.radius} * 100cqmin)`,
      width: `calc(${2 * def.radius} * 100cqmin)`,
      height: `calc(${2 * def.radius} * 100cqmin)`,
      borderRadius: "50%",
      boxSizing: "border-box",
      border: "2px solid rgba(255, 255, 255, 0.55)",
      background: "rgba(0, 0, 0, 0.28)",
      pointerEvents: "auto",
      touchAction: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "rgba(255, 255, 255, 0.85)",
      font: `600 calc(${def.radius * 0.6} * 100cqmin) / 1 sans-serif`,
    } satisfies Partial<CSSStyleDeclaration>);
    let knob: HTMLElement | null = null;
    if (def.kind === "button") {
      if (def.label) node.textContent = def.label;
    } else if (def.kind === "stick") {
      knob = doc.createElement("div");
      Object.assign(knob.style, {
        position: "absolute",
        left: "30%",
        top: "30%",
        width: "40%",
        height: "40%",
        borderRadius: "50%",
        background: "rgba(255, 255, 255, 0.55)",
        pointerEvents: "none",
      } satisfies Partial<CSSStyleDeclaration>);
      node.append(knob);
    } else {
      for (const [x, y] of [
        [50, 18],
        [82, 50],
        [50, 82],
        [18, 50],
      ] as const) {
        const arm = doc.createElement("div");
        Object.assign(arm.style, {
          position: "absolute",
          left: `${x - 8}%`,
          top: `${y - 8}%`,
          width: "16%",
          height: "16%",
          borderRadius: "2px",
          background: "rgba(255, 255, 255, 0.55)",
          pointerEvents: "none",
        } satisfies Partial<CSSStyleDeclaration>);
        node.append(arm);
      }
    }
    node.addEventListener("pointerdown", (e) => press(def.id, e));
    root.append(node);
    nodes.set(def.id, { def, node, knob });
  }
  host.append(root);

  const held = new Map<number, Held>();
  let shown = true;
  let destroyed = false;

  /** A control's centre and radius in page px, from the host's current rect. */
  function geometry(def: TouchControlDef): { cx: number; cy: number; r: number } {
    const rect = host.getBoundingClientRect();
    const side = Math.min(rect.width, rect.height);
    return {
      cx: rect.left + def.at[0] * side,
      cy: rect.top + def.at[1] * side,
      r: def.radius * side,
    };
  }

  function valueAt(def: TouchControlDef, clientX: number, clientY: number): TouchControlValue {
    if (def.kind === "button") return { down: true };
    const { cx, cy, r } = geometry(def);
    if (r <= 0) return { x: 0, y: 0 };
    const dx = (clientX - cx) / r;
    const dy = (clientY - cy) / r;
    if (def.kind === "stick") return qVector({ x: dx, y: dy });
    if (Math.sqrt(dx * dx + dy * dy) < DPAD_CENTER) return { x: 0, y: 0 };
    const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    const angle = (sector * Math.PI) / 4;
    return qVector({ x: Math.cos(angle), y: Math.sin(angle) });
  }

  function report(h: Held, value: TouchControlValue): void {
    const key = keyOf(value);
    if (key === h.last) return;
    h.last = key;
    if (h.knob && !("down" in value)) {
      h.knob.style.transform = `translate(${value.x * 125}%, ${value.y * 125}%)`;
    }
    h.node.dataset.active =
      "down" in value ? String(value.down) : String(value.x !== 0 || value.y !== 0);
    sink(h.def.id, value);
  }

  const rest = (def: TouchControlDef): TouchControlValue =>
    def.kind === "button" ? { down: false } : { x: 0, y: 0 };

  function press(id: string, e: PointerEvent): void {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    if (!shown || destroyed) return;
    const entry = nodes.get(id);
    if (!entry) return;
    for (const h of held.values()) if (h.def.id === id) return;
    const h: Held = { ...entry, last: keyOf(rest(entry.def)) };
    held.set(e.pointerId, h);
    entry.node.setPointerCapture?.(e.pointerId);
    report(h, valueAt(entry.def, e.clientX, e.clientY));
  }

  function release(pointerId: number): void {
    const h = held.get(pointerId);
    if (!h) return;
    held.delete(pointerId);
    report(h, rest(h.def));
  }

  // Capture phase on the window: a held touch's moves and release reach the
  // control first and go no further, so the pointer never sees them.
  const onMove = (e: PointerEvent): void => {
    const h = held.get(e.pointerId);
    if (!h) return;
    e.stopPropagation();
    if (h.def.kind !== "button") report(h, valueAt(h.def, e.clientX, e.clientY));
  };
  const onEnd = (e: PointerEvent): void => {
    if (!held.has(e.pointerId)) return;
    e.stopPropagation();
    release(e.pointerId);
  };
  const listeners: [string, EventListener][] = [
    ["pointermove", onMove as EventListener],
    ["pointerup", onEnd as EventListener],
    ["pointercancel", onEnd as EventListener],
  ];
  for (const [type, fn] of listeners) win?.addEventListener(type, fn, true);

  function releaseAll(): void {
    for (const id of [...held.keys()]) release(id);
  }

  return {
    show(on) {
      if (destroyed || on === shown) return;
      shown = on;
      if (!on) releaseAll();
      root.style.display = on ? "" : "none";
    },
    destroy() {
      if (destroyed) return;
      releaseAll();
      destroyed = true;
      for (const [type, fn] of listeners) win?.removeEventListener(type, fn, true);
      root.remove();
      nodes.clear();
      if (restorePosition !== null) host.style.position = restorePosition;
    },
    hitTest(clientX, clientY) {
      if (!shown || destroyed) return null;
      let best: string | null = null;
      let bestDist = Infinity;
      for (const { def } of nodes.values()) {
        const { cx, cy, r } = geometry(def);
        const dist = Math.sqrt((clientX - cx) ** 2 + (clientY - cy) ** 2);
        if (dist <= r && dist < bestDist) {
          best = def.id;
          bestDist = dist;
        }
      }
      return best;
    },
  };
}

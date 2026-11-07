import type { Vec2 } from "./types";

export type ToolEvent =
  | {
      kind: "pointer";
      type: "down" | "move" | "up" | "wheel";
      /** CSS pixels from the input target's top-left corner. */
      screen: Vec2;
      button: number;
      deltaY: number;
      native: PointerEvent | WheelEvent | MouseEvent;
    }
  | {
      kind: "key";
      type: "down" | "up";
      key: string;
      native: KeyboardEvent;
      /** Focus was outside the input target (a panel elsewhere in the key target); play input ignores it. */
      outsideTarget?: boolean;
      /** Typed into a text field; only consumers with `editable` are offered it. */
      editable?: boolean;
    };

export type ToolConsumer = {
  id: string;
  /** Higher wins. Engine bands: play 0, game tools 100, editor tools 200, the debug overlay 300. */
  priority: number;
  /** Also offered key presses typed into a text field, which nobody else sees (the editor's Mod+S). */
  editable?: boolean;
  /** Claim the event; the first claiming consumer by priority gets it, nobody else does. */
  accepts(e: ToolEvent): boolean;
  handle(e: ToolEvent): void;
};

export type ToolRouter = {
  /** Returns the unregister function. Ids are unique per router. */
  register(c: ToolConsumer): () => void;
  /** The id of the consumer that took the event, or null. */
  dispatch(e: ToolEvent): string | null;
  /**
   * Turns the target's DOM events into `ToolEvent`s; a Window target has no
   * offset. Keys come from `keyTarget` when given (an element holding the
   * target and the panels beside it), pointers always from `target`.
   */
  attach(target: HTMLElement | Window, keyTarget?: HTMLElement | Window): void;
  detach(): void;
  destroy(): void;
};

export const TOOL_PRIORITY = { play: 0, game: 100, editor: 200, debug: 300 } as const;

/** A text field, a select or a contenteditable: key presses there are typing, not input. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  };
  if (el.isContentEditable === true) return true;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return (
    typeof el.closest === "function" &&
    el.closest('[contenteditable]:not([contenteditable="false"])') != null
  );
}

/** The configured target, else the canvas made focusable so it can take key events. */
export function resolveInputTarget(canvas: HTMLCanvasElement, target?: HTMLElement): HTMLElement {
  if (target) return target;
  if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
  return canvas;
}

/** Decides whether play, a game tool or an editor tool gets each pointer and key event. */
export function createToolRouter(): ToolRouter {
  // Highest priority first; equal priorities keep registration order.
  const consumers: ToolConsumer[] = [];
  let removeListeners: (() => void) | null = null;

  function register(c: ToolConsumer): () => void {
    if (consumers.some((other) => other.id === c.id)) {
      throw new Error(`tool consumer "${c.id}" is already registered`);
    }
    const at = consumers.findIndex((other) => other.priority < c.priority);
    consumers.splice(at === -1 ? consumers.length : at, 0, c);
    return () => {
      const i = consumers.indexOf(c);
      if (i !== -1) consumers.splice(i, 1);
    };
  }

  function dispatch(e: ToolEvent): string | null {
    const editable = e.kind === "key" && e.editable === true;
    for (const c of consumers.slice()) {
      if (editable && !c.editable) continue;
      if (c.accepts(e)) {
        c.handle(e);
        return c.id;
      }
    }
    return null;
  }

  function attach(target: HTMLElement | Window, keyTarget: HTMLElement | Window = target): void {
    detach();
    const inside = (node: EventTarget | null): boolean =>
      !("contains" in target) || (node instanceof Node && target.contains(node));

    const pointer =
      (type: "down" | "move" | "up" | "wheel") =>
      (native: PointerEvent | WheelEvent | MouseEvent): void => {
        const origin =
          "getBoundingClientRect" in target ? target.getBoundingClientRect() : { left: 0, top: 0 };
        dispatch({
          kind: "pointer",
          type,
          screen: { x: native.clientX - origin.left, y: native.clientY - origin.top },
          button: native.button,
          deltaY: "deltaY" in native ? native.deltaY : 0,
          native,
        });
      };
    // A release always routes, so a key pressed before focus moved into a field still lets go.
    const key =
      (type: "down" | "up") =>
      (native: KeyboardEvent): void => {
        const e: ToolEvent = { kind: "key", type, key: native.key, native };
        if (type === "down" && isEditableTarget(native.target)) e.editable = true;
        if (!inside(native.target)) e.outsideTarget = true;
        dispatch(e);
      };

    const listeners: [HTMLElement | Window, string, EventListener, AddEventListenerOptions?][] = [
      [target, "pointerdown", pointer("down") as EventListener],
      [target, "pointermove", pointer("move") as EventListener],
      [target, "pointerup", pointer("up") as EventListener],
      [target, "wheel", pointer("wheel") as EventListener, { passive: false }],
      [keyTarget, "keydown", key("down") as EventListener],
      [keyTarget, "keyup", key("up") as EventListener],
    ];
    for (const [on, type, fn, options] of listeners) on.addEventListener(type, fn, options);
    removeListeners = () => {
      for (const [on, type, fn] of listeners) on.removeEventListener(type, fn);
    };
  }

  function detach(): void {
    removeListeners?.();
    removeListeners = null;
  }

  function destroy(): void {
    detach();
    consumers.length = 0;
  }

  return { register, dispatch, attach, detach, destroy };
}

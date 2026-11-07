import { createToolRouter, isEditableTarget, TOOL_PRIORITY } from "./tool-router";
import type { ToolConsumer, ToolEvent, ToolRouter } from "./tool-router";
import type { InputAction, InputBinding } from "./types";

export type InputSystem = {
  /** Listens on `target` by itself; inside the shell a tool router feeds `consumer()` instead. */
  attach: (target: HTMLElement | Window) => void;
  detach: () => void;
  poll: (tick: number) => InputAction[];
  /** The pointer in CSS pixels from the input target's top-left corner. */
  getMousePosition: () => { x: number; y: number };
  /** Whether the pointer has moved over the input target yet. */
  hasPointer: () => boolean;
  /** While disabled, key presses are ignored and their default actions left alone. */
  setEnabled: (enabled: boolean) => void;
  isKeyDown: (key: string) => boolean;
  /** Lets go of every held key, for when the target loses focus and its keyups go elsewhere. */
  releaseAll: (timestamp?: number) => void;
  /** Drops queued actions and forgets held keys without releasing them, so nothing pressed before reaches the next tick. */
  flush: () => void;
  /** Play input as a router consumer at `TOOL_PRIORITY.play`: key presses and the pointer position. */
  consumer: () => ToolConsumer;
  destroy: () => void;
};

/** Pressing 'd' then Shift gives keyup 'D'; single characters fold to lowercase, named keys stay. */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Browser and app shortcuts (Mod+S), and typing into a field, are not game input. */
function isForeignKey(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target);
}

/** Turns key presses into the actions `bindings` names; the engine gives no action a meaning. */
export function createInputSystem(bindings: readonly InputBinding[]): InputSystem {
  const actionQueue: InputAction[] = [];
  const keysDown = new Set<string>();
  const mousePosition = { x: 0, y: 0 };
  let pointerSeen = false;

  const keyToActions = new Map<string, string[]>();
  for (const binding of bindings) {
    for (const key of binding.keys) {
      const existing = keyToActions.get(key) ?? [];
      existing.push(binding.action);
      keyToActions.set(key, existing);
    }
  }

  let enabled = true;
  let ownRouter: ToolRouter | null = null;

  function queue(key: string, pressed: boolean, timestamp: number): boolean {
    const actions = keyToActions.get(key);
    if (!actions) return false;
    for (const action of actions) actionQueue.push({ action, pressed, tick: 0, timestamp });
    return true;
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    const key = normalizeKey(e.key);
    keysDown.add(key);
    // A bound key doesn't also scroll the page (arrows, space).
    if (queue(key, true, e.timeStamp)) e.preventDefault();
  }

  function handleKeyUp(e: KeyboardEvent): void {
    const key = normalizeKey(e.key);
    keysDown.delete(key);
    queue(key, false, e.timeStamp);
  }

  const play: ToolConsumer = {
    id: "play",
    priority: TOOL_PRIORITY.play,
    accepts(e: ToolEvent) {
      if (e.kind === "pointer") return e.type === "move";
      if (e.type === "up") return true;
      return enabled && !e.outsideTarget && !isForeignKey(e.native);
    },
    handle(e: ToolEvent) {
      if (e.kind === "pointer") {
        mousePosition.x = e.screen.x;
        mousePosition.y = e.screen.y;
        pointerSeen = true;
      } else if (e.type === "down") {
        handleKeyDown(e.native);
      } else {
        handleKeyUp(e.native);
      }
    },
  };

  function attach(target: HTMLElement | Window): void {
    detach();
    ownRouter = createToolRouter();
    ownRouter.register(play);
    ownRouter.attach(target);
  }

  function detach(): void {
    ownRouter?.destroy();
    ownRouter = null;
  }

  function releaseAll(timestamp = 0): void {
    for (const key of keysDown) queue(key, false, timestamp);
    keysDown.clear();
  }

  function flush(): void {
    actionQueue.length = 0;
    keysDown.clear();
  }

  function poll(tick: number): InputAction[] {
    const actions = actionQueue.splice(0);
    for (const action of actions) action.tick = tick;
    return actions;
  }

  function destroy(): void {
    detach();
    actionQueue.length = 0;
    keysDown.clear();
  }

  return {
    attach,
    detach,
    poll,
    getMousePosition: () => ({ ...mousePosition }),
    hasPointer: () => pointerSeen,
    setEnabled: (next) => void (enabled = next),
    isKeyDown: (key) => keysDown.has(key),
    releaseAll,
    flush,
    consumer: () => play,
    destroy,
  };
}

import { describe, expect, it, vi } from "vite-plus/test";

import { createInputSystem } from "../input";
import type { InputBinding } from "../types";

// Minimal mock for event target
function createMockTarget() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener: vi.fn((type: string, handler: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    }),
    removeEventListener: vi.fn((type: string, handler: EventListener) => {
      listeners.get(type)?.delete(handler);
    }),
    dispatch(type: string, eventInit: Partial<KeyboardEvent | MouseEvent>) {
      const handlers = listeners.get(type);
      if (!handlers) return;
      const event = { preventDefault: vi.fn(), ...eventInit } as unknown;
      for (const handler of handlers) {
        handler(event as Event);
      }
    },
  };
}

describe("createInputSystem", () => {
  it("generates actions from key presses using default bindings", () => {
    const input = createInputSystem();
    const target = createMockTarget();
    input.attach(target as unknown as HTMLElement);

    target.dispatch("keydown", {
      key: "ArrowRight",
      repeat: false,
      timeStamp: 100,
    });

    const actions = input.poll(1);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action: "move_right",
      pressed: true,
      tick: 1,
    });

    input.destroy();
  });

  it("generates release actions on keyup", () => {
    const input = createInputSystem();
    const target = createMockTarget();
    input.attach(target as unknown as HTMLElement);

    target.dispatch("keydown", { key: "a", repeat: false, timeStamp: 100 });
    target.dispatch("keyup", { key: "a", timeStamp: 200 });

    const actions = input.poll(1);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ action: "move_left", pressed: true });
    expect(actions[1]).toMatchObject({ action: "move_left", pressed: false });

    input.destroy();
  });

  it("ignores key repeat events", () => {
    const input = createInputSystem();
    const target = createMockTarget();
    input.attach(target as unknown as HTMLElement);

    target.dispatch("keydown", { key: "d", repeat: false, timeStamp: 100 });
    target.dispatch("keydown", { key: "d", repeat: true, timeStamp: 150 });
    target.dispatch("keydown", { key: "d", repeat: true, timeStamp: 200 });

    const actions = input.poll(1);
    expect(actions).toHaveLength(1); // only the first press
    expect(actions[0].pressed).toBe(true);

    input.destroy();
  });

  it("poll drains the queue — second poll returns empty", () => {
    const input = createInputSystem();
    const target = createMockTarget();
    input.attach(target as unknown as HTMLElement);

    target.dispatch("keydown", { key: " ", repeat: false, timeStamp: 100 });

    const first = input.poll(1);
    expect(first).toHaveLength(1);

    const second = input.poll(2);
    expect(second).toHaveLength(0);

    input.destroy();
  });

  it("supports custom bindings", () => {
    const bindings: InputBinding[] = [
      { action: "shoot", keys: ["f"] },
      { action: "dash", keys: ["Shift"] },
    ];
    const input = createInputSystem(bindings);
    const target = createMockTarget();
    input.attach(target as unknown as HTMLElement);

    target.dispatch("keydown", { key: "f", repeat: false, timeStamp: 100 });
    target.dispatch("keydown", {
      key: "Shift",
      repeat: false,
      timeStamp: 110,
    });

    const actions = input.poll(1);
    expect(actions).toHaveLength(2);
    expect(actions[0].action).toBe("shoot");
    expect(actions[1].action).toBe("dash");

    input.destroy();
  });

  it("ignores unbound keys", () => {
    const input = createInputSystem();
    const target = createMockTarget();
    input.attach(target as unknown as HTMLElement);

    target.dispatch("keydown", { key: "z", repeat: false, timeStamp: 100 });

    const actions = input.poll(1);
    expect(actions).toHaveLength(0);

    input.destroy();
  });

  it("tracks mouse position", () => {
    const input = createInputSystem();
    const target = createMockTarget();
    input.attach(target as unknown as HTMLElement);

    target.dispatch("mousemove", { clientX: 150, clientY: 300 });

    const pos = input.getMousePosition();
    expect(pos).toEqual({ x: 150, y: 300 });

    input.destroy();
  });

  it("isKeyDown tracks current key state", () => {
    const input = createInputSystem();
    const target = createMockTarget();
    input.attach(target as unknown as HTMLElement);

    expect(input.isKeyDown("a")).toBe(false);

    target.dispatch("keydown", { key: "a", repeat: false, timeStamp: 100 });
    expect(input.isKeyDown("a")).toBe(true);

    target.dispatch("keyup", { key: "a", timeStamp: 200 });
    expect(input.isKeyDown("a")).toBe(false);

    input.destroy();
  });

  it("destroy removes listeners and clears state", () => {
    const input = createInputSystem();
    const target = createMockTarget();
    input.attach(target as unknown as HTMLElement);

    target.dispatch("keydown", { key: "a", repeat: false, timeStamp: 100 });
    input.destroy();

    // Queue should be cleared
    const actions = input.poll(1);
    expect(actions).toHaveLength(0);

    // Listeners should be removed
    expect(target.removeEventListener).toHaveBeenCalled();
  });

  it("preventDefault is called for bound keys", () => {
    const input = createInputSystem();
    const target = createMockTarget();
    input.attach(target as unknown as HTMLElement);

    const preventDefault = vi.fn();
    target.dispatch("keydown", {
      key: "ArrowUp",
      repeat: false,
      timeStamp: 100,
      preventDefault,
    } as unknown as Partial<KeyboardEvent>);

    expect(preventDefault).toHaveBeenCalled();

    input.destroy();
  });
});

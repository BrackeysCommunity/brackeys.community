import { describe, expect, it, vi } from "vite-plus/test";

import { GameEventEmitter } from "../events";

describe("GameEventEmitter", () => {
  it("calls handler when event is emitted", () => {
    const emitter = new GameEventEmitter();
    const handler = vi.fn();

    emitter.on("game:tick", handler);
    emitter.emit("game:tick", { tick: 1 });

    expect(handler).toHaveBeenCalledWith({ tick: 1 });
  });

  it("supports multiple handlers for the same event", () => {
    const emitter = new GameEventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on("game:tick", handler1);
    emitter.on("game:tick", handler2);
    emitter.emit("game:tick", { tick: 5 });

    expect(handler1).toHaveBeenCalledWith({ tick: 5 });
    expect(handler2).toHaveBeenCalledWith({ tick: 5 });
  });

  it("does not call handler after off()", () => {
    const emitter = new GameEventEmitter();
    const handler = vi.fn();

    emitter.on("game:tick", handler);
    emitter.off("game:tick", handler);
    emitter.emit("game:tick", { tick: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it("handles events with no payload", () => {
    const emitter = new GameEventEmitter();
    const handler = vi.fn();

    emitter.on("game:start", handler);
    emitter.emit("game:start");

    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not throw when emitting event with no listeners", () => {
    const emitter = new GameEventEmitter();
    expect(() => emitter.emit("game:start")).not.toThrow();
  });

  it("clears all listeners on destroy()", () => {
    const emitter = new GameEventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on("game:start", handler1);
    emitter.on("game:tick", handler2);
    emitter.destroy();

    emitter.emit("game:start");
    emitter.emit("game:tick", { tick: 1 });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it("does not call unrelated event handlers", () => {
    const emitter = new GameEventEmitter();
    const startHandler = vi.fn();
    const tickHandler = vi.fn();

    emitter.on("game:start", startHandler);
    emitter.on("game:tick", tickHandler);
    emitter.emit("game:start");

    expect(startHandler).toHaveBeenCalledOnce();
    expect(tickHandler).not.toHaveBeenCalled();
  });
});

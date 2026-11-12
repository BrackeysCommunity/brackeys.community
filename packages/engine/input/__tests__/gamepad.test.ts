import { describe, expect, it, vi } from "vite-plus/test";

import { createGamepadReader, type PadSnapshot } from "../gamepad";

type PadInit = {
  index?: number;
  id?: string;
  mapping?: string;
  pressed?: number[];
  values?: Record<number, number>;
  axes?: number[];
  buttons?: number;
};

function pad(init: PadInit = {}): PadSnapshot {
  const count = init.buttons ?? 17;
  return {
    index: init.index ?? 0,
    id: init.id ?? "pad",
    mapping: init.mapping ?? "standard",
    connected: true,
    buttons: Array.from({ length: count }, (_, i) => {
      const pressed = init.pressed?.includes(i) ?? false;
      return { pressed, value: init.values?.[i] ?? (pressed ? 1 : 0) };
    }),
    axes: init.axes ?? [0, 0, 0, 0],
  };
}

function fake() {
  let pads: (PadSnapshot | null)[] = [];
  const getGamepads = vi.fn(() => pads);
  return {
    getGamepads,
    set(...next: (PadSnapshot | null)[]) {
      pads = next;
    },
  };
}

describe("createGamepadReader", () => {
  it("reports no pads when getGamepads is absent", () => {
    const reader = createGamepadReader({ getGamepads: undefined });
    const polled = reader.poll(0);
    expect(polled).toEqual({ tick: 0, changes: [], connected: [], disconnected: [] });
    expect(reader.pads()).toEqual([]);
  });

  it("names a standard pad's buttons", () => {
    const f = fake();
    const reader = createGamepadReader({ getGamepads: f.getGamepads });
    f.set(pad());
    expect(reader.poll(0)).toEqual({ tick: 0, changes: [], connected: [0], disconnected: [] });

    f.set(pad({ pressed: [0, 12, 16] }));
    expect(reader.poll(1).changes).toEqual([
      { pad: 0, kind: "button", button: "south", index: 0, pressed: true },
      { pad: 0, kind: "button", button: "dpad-up", index: 12, pressed: true },
      { pad: 0, kind: "button", button: "home", index: 16, pressed: true },
    ]);
    expect(reader.reading(0, { device: "pad", button: "south" })).toBe(1);
    expect(reader.reading(0, { device: "pad", button: "east" })).toBe(0);
    expect(reader.reading(0, { device: "pad", button: 12 })).toBe(1);
  });

  it("keeps each pad's browser timestamp as of the last poll", () => {
    const f = fake();
    const reader = createGamepadReader({ getGamepads: f.getGamepads });
    f.set({ ...pad(), timestamp: 120.5 }, pad({ index: 1 }));
    reader.poll(0);
    expect(reader.updatedAt(0)).toBe(120.5);
    expect(reader.updatedAt(1)).toBeUndefined();
    f.set({ ...pad(), timestamp: Number.NaN });
    reader.poll(1);
    expect(reader.updatedAt(0)).toBeUndefined();
    expect(reader.updatedAt(1)).toBeUndefined();
  });

  it("reports a pad without the standard mapping by raw index", () => {
    const f = fake();
    const reader = createGamepadReader({ getGamepads: f.getGamepads, deadzone: 0.2 });
    f.set(pad({ mapping: "", buttons: 20, pressed: [19], axes: [0.6, 0, -1] }));
    const polled = reader.poll(0);
    expect(polled.connected).toEqual([0]);
    expect(polled.changes).toEqual([
      { pad: 0, kind: "button", button: 19, index: 19, pressed: true },
      { pad: 0, kind: "axis", axis: 0, index: 0, value: 0.5 },
      { pad: 0, kind: "axis", axis: 2, index: 2, value: -1 },
    ]);
    expect(reader.reading(0, { device: "pad", button: 19 })).toBe(1);
    expect(reader.reading(0, { device: "pad", button: "south" })).toBe(0);
    expect(reader.reading(0, { device: "pad", axis: 2 })).toBe(-1);
    expect(reader.reading(0, { device: "pad", axis: "left-x" })).toBe(0);
    expect(reader.reading(0, { device: "pad", stick: "left" })).toEqual({ x: 0, y: 0 });
  });

  it("applies the radial deadzone to sticks and quantises to 1/1000", () => {
    const f = fake();
    const reader = createGamepadReader({ getGamepads: f.getGamepads });
    f.set(pad({ axes: [0.1, 0.1, 0, 0] }));
    expect(reader.poll(0).changes).toEqual([]);
    expect(reader.reading(0, { device: "pad", stick: "left" })).toEqual({ x: 0, y: 0 });

    f.set(pad({ axes: [0.3, 0.4, 0, 0] }));
    const changes = reader.poll(1).changes;
    // Length 0.5 rescaled from 0.15…1: (0.5 - 0.15) / 0.85 along (0.6, 0.8).
    const scaled = (0.5 - 0.15) / 0.85;
    const x = Math.round(0.6 * scaled * 1000) / 1000;
    const y = Math.round(0.8 * scaled * 1000) / 1000;
    expect(changes).toEqual([
      { pad: 0, kind: "axis", axis: "left-x", index: 0, value: x },
      { pad: 0, kind: "axis", axis: "left-y", index: 1, value: y },
      { pad: 0, kind: "stick", stick: "left", x, y },
    ]);
    expect(reader.reading(0, { device: "pad", stick: "left" })).toEqual({ x, y });
    expect(reader.reading(0, { device: "pad", axis: "left-y" })).toBe(y);

    f.set(pad({ axes: [0.3000001, 0.4000001, 0, 0] }));
    expect(reader.poll(2).changes).toEqual([]);
  });

  it("reads a standard pad's analog triggers as the lt and rt axes", () => {
    const f = fake();
    const reader = createGamepadReader({ getGamepads: f.getGamepads });
    f.set(pad({ values: { 6: 0.25 } }));
    expect(reader.poll(0).changes).toEqual([{ pad: 0, kind: "axis", axis: "lt", value: 0.25 }]);
    f.set(pad({ pressed: [7], values: { 6: 0.25, 7: 0.98765 } }));
    expect(reader.poll(1).changes).toEqual([
      { pad: 0, kind: "button", button: "rt", index: 7, pressed: true },
      { pad: 0, kind: "axis", axis: "rt", value: 0.988 },
    ]);
    expect(reader.reading(0, { device: "pad", axis: "rt" })).toBe(0.988);
  });

  it("reports an edge once: a held button raises nothing more, a repeat poll of a tick reads nothing", () => {
    const f = fake();
    const reader = createGamepadReader({ getGamepads: f.getGamepads });
    f.set(pad({ pressed: [1] }));
    expect(reader.poll(0).changes).toHaveLength(1);
    expect(reader.poll(0).changes).toEqual([]);
    expect(f.getGamepads).toHaveBeenCalledTimes(1);

    expect(reader.poll(1).changes).toEqual([]);
    expect(reader.poll(2).changes).toEqual([]);
    expect(f.getGamepads).toHaveBeenCalledTimes(3);

    f.set(pad());
    expect(reader.poll(3).changes).toEqual([
      { pad: 0, kind: "button", button: "east", index: 1, pressed: false },
    ]);
  });

  it("releases a disconnected pad's held inputs and reports it gone", () => {
    const f = fake();
    const reader = createGamepadReader({ getGamepads: f.getGamepads });
    f.set(pad(), pad({ index: 1, id: "other" }));
    expect(reader.poll(0).connected).toEqual([0, 1]);

    f.set(pad({ pressed: [0], axes: [1, 0, 0, 0] }), pad({ index: 1, id: "other" }));
    reader.poll(1);

    f.set(null, { ...pad({ index: 1, id: "other" }) });
    expect(reader.poll(2)).toEqual({
      tick: 2,
      changes: [
        { pad: 0, kind: "button", button: "south", index: 0, pressed: false },
        { pad: 0, kind: "axis", axis: "left-x", index: 0, value: 0 },
        { pad: 0, kind: "stick", stick: "left", x: 0, y: 0 },
      ],
      connected: [],
      disconnected: [0],
    });
    expect(reader.pads()).toEqual([1]);
    expect(reader.reading(0, { device: "pad", button: "south" })).toBe(0);

    f.set({ ...pad({ index: 1, id: "other" }), connected: false });
    expect(reader.poll(3).disconnected).toEqual([1]);
    expect(reader.pads()).toEqual([]);
  });

  it("treats a new pad at a known index as a disconnect and a connect", () => {
    const f = fake();
    const reader = createGamepadReader({ getGamepads: f.getGamepads });
    f.set(pad({ pressed: [3] }));
    reader.poll(0);
    f.set(pad({ id: "new", pressed: [3] }));
    expect(reader.poll(1)).toEqual({
      tick: 1,
      changes: [
        { pad: 0, kind: "button", button: "north", index: 3, pressed: false },
        { pad: 0, kind: "button", button: "north", index: 3, pressed: true },
      ],
      connected: [0],
      disconnected: [0],
    });
  });

  it("reads a throwing getGamepads as no pads, and nothing after destroy", () => {
    const f = fake();
    const reader = createGamepadReader({ getGamepads: f.getGamepads });
    f.set(pad());
    reader.poll(0);
    f.getGamepads.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(reader.poll(1).disconnected).toEqual([0]);
    reader.poll(2);
    reader.destroy();
    expect(reader.pads()).toEqual([]);
    expect(reader.poll(3)).toEqual({ tick: 3, changes: [], connected: [], disconnected: [] });
  });

  it("keeps a frame cursor of its own, so a frame poll and the tick poll each see one press once", () => {
    const f = fake();
    const reader = createGamepadReader({ getGamepads: f.getGamepads });
    const south = { pad: 0, kind: "button", button: "south", index: 0, pressed: true };
    f.set(pad());
    expect(reader.pollFrame()).toEqual({ tick: -1, changes: [], connected: [0], disconnected: [] });
    expect(reader.poll(0).connected).toEqual([0]);

    f.set(pad({ pressed: [0] }));
    expect(reader.pollFrame().changes).toEqual([south]);
    expect(reader.pollFrame().changes).toEqual([]);
    expect(reader.frame.reading(0, { device: "pad", button: "south" })).toBe(1);
    // The tick cursor still reads the pad as it was at tick 0.
    expect(reader.reading(0, { device: "pad", button: "south" })).toBe(0);
    expect(reader.poll(1).changes).toEqual([south]);
    expect(reader.poll(2).changes).toEqual([]);
    expect(reader.pollFrame()).toEqual({ tick: 2, changes: [], connected: [], disconnected: [] });

    f.set(pad({ pressed: [0], index: 0, id: "pad" }), pad({ index: 1, id: "other" }));
    expect(reader.poll(3).connected).toEqual([1]);
    expect(reader.frame.pads()).toEqual([0]);
    expect(reader.pollFrame().connected).toEqual([1]);
    expect(reader.frame.pads()).toEqual([0, 1]);

    reader.destroy();
    expect(reader.frame.pads()).toEqual([]);
    expect(reader.pollFrame().changes).toEqual([]);
  });
});

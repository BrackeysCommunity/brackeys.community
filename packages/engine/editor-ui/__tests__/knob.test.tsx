// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Knob, KNOB_WHEEL_SETTLE_MS, type KnobProps } from "../kit/knob";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A knob that keeps what it commits, as a host's doc would, and feeds its preview back as the value. */
function Held(
  props: Omit<KnobProps, "value" | "onCommit"> & { start: number; spy?: (v: number) => void },
) {
  const { start, spy, onChange, ...rest } = props;
  const [value, setValue] = useState(start);
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <Knob
      {...rest}
      value={preview ?? value}
      onChange={(v) => {
        setPreview(v);
        onChange?.(v);
      }}
      onCommit={(v) => {
        setPreview(null);
        setValue(v);
        spy?.(v);
      }}
    />
  );
}

const dial = (name = "Cutoff") => screen.getByRole("slider", { name });

function drag(el: HTMLElement, from: number, to: number, init: { shiftKey?: boolean } = {}) {
  fireEvent.pointerDown(el, { clientY: from, button: 0, pointerId: 1 });
  fireEvent.pointerMove(window, { clientY: to, pointerId: 1, ...init });
  fireEvent.pointerUp(window, { clientY: to, pointerId: 1 });
}

describe("Knob", () => {
  it("is a named slider with its range, value, unit and whether it's the default", () => {
    render(
      <Knob
        label="Res"
        aria-label="Filter resonance"
        value={0.25}
        min={0}
        max={1}
        step={0.01}
        unit="%"
        defaultValue={0.25}
        onCommit={() => {}}
      />,
    );
    const el = dial("Filter resonance");
    expect(el.getAttribute("aria-valuemin")).toBe("0");
    expect(el.getAttribute("aria-valuemax")).toBe("1");
    expect(el.getAttribute("aria-valuenow")).toBe("0.25");
    expect(el.getAttribute("aria-valuetext")).toBe("0.25 %, default");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(screen.getByText("Res")).toBeTruthy();
  });

  it("steps with the arrows (Shift ×10), a tenth of the turn with Page keys, ends with Home and End", () => {
    const commit = vi.fn();
    render(<Held label="Cutoff" start={50} min={0} max={100} step={1} spy={commit} />);
    const el = dial();
    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(commit).toHaveBeenLastCalledWith(51);
    fireEvent.keyDown(el, { key: "ArrowDown", shiftKey: true });
    expect(commit).toHaveBeenLastCalledWith(41);
    fireEvent.keyDown(el, { key: "PageUp" });
    expect(commit).toHaveBeenLastCalledWith(51);
    fireEvent.keyDown(el, { key: "End" });
    expect(commit).toHaveBeenLastCalledWith(100);
    fireEvent.keyDown(el, { key: "ArrowUp" });
    fireEvent.keyDown(el, { key: "Home" });
    expect(commit).toHaveBeenLastCalledWith(0);
    // At the top already: no write for a key that changes nothing.
    expect(commit).toHaveBeenCalledTimes(5);
  });

  it("turns with a vertical drag, previewing on the way and committing once on release", () => {
    const change = vi.fn();
    const commit = vi.fn();
    render(
      <Held label="Cutoff" start={0} min={0} max={100} step={1} onChange={change} spy={commit} />,
    );
    const el = dial();
    fireEvent.pointerDown(el, { clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 250, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 200, pointerId: 1 });
    expect(change).toHaveBeenLastCalledWith(50);
    expect(el.getAttribute("aria-valuenow")).toBe("50");
    expect(commit).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientY: 200, pointerId: 1 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(50);
    // A press without a move changes nothing.
    drag(el, 100, 100);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("turns ten times finer with Shift held, and a log dial spreads its range evenly", () => {
    const commit = vi.fn();
    render(<Held label="Cutoff" start={0} min={0} max={100} step={0.1} spy={commit} />);
    drag(dial(), 300, 200, { shiftKey: true });
    expect(commit).toHaveBeenLastCalledWith(5);
    cleanup();
    render(
      <Held label="Cutoff" start={20} min={20} max={20_000} step={1} scale="log" spy={commit} />,
    );
    // Half the turn on a log dial is the geometric middle.
    drag(dial(), 300, 200);
    expect(commit).toHaveBeenLastCalledWith(632);
  });

  it("resets on double-click or Delete: to its default, or through onReset", () => {
    const commit = vi.fn();
    render(
      <Held label="Cutoff" start={80} min={0} max={100} step={1} defaultValue={10} spy={commit} />,
    );
    fireEvent.doubleClick(dial());
    expect(commit).toHaveBeenLastCalledWith(10);
    cleanup();
    const reset = vi.fn();
    render(<Knob label="Cutoff" value={80} min={0} max={100} onCommit={commit} onReset={reset} />);
    fireEvent.keyDown(dial(), { key: "Delete" });
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("types a value from its readout or Enter, snapped and held to the range; Escape cancels", () => {
    const commit = vi.fn();
    render(<Held label="Cutoff" start={5} min={0} max={100} step={0.5} unit="Hz" spy={commit} />);
    fireEvent.click(screen.getByRole("button", { name: "Type a value for Cutoff" }));
    const input = screen.getByRole("textbox", { name: "Cutoff value" });
    fireEvent.change(input, { target: { value: "42.3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commit).toHaveBeenLastCalledWith(42.5);
    fireEvent.keyDown(dial(), { key: "Enter" });
    const again = screen.getByRole("textbox", { name: "Cutoff value" });
    fireEvent.change(again, { target: { value: "500" } });
    fireEvent.keyDown(again, { key: "Enter" });
    expect(commit).toHaveBeenLastCalledWith(100);
    fireEvent.keyDown(dial(), { key: "Enter" });
    const cancelled = screen.getByRole("textbox", { name: "Cutoff value" });
    fireEvent.change(cancelled, { target: { value: "1" } });
    fireEvent.keyDown(cancelled, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("takes the wheel only while focused, committing once it rests", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    render(<Held label="Cutoff" start={50} min={0} max={100} step={1} spy={commit} />);
    const el = dial();
    fireEvent.wheel(el, { deltaY: -100 });
    expect(el.getAttribute("aria-valuenow")).toBe("50");
    act(() => el.focus());
    fireEvent.wheel(el, { deltaY: -100 });
    fireEvent.wheel(el, { deltaY: -100 });
    expect(el.getAttribute("aria-valuenow")).toBe("54");
    expect(commit).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(KNOB_WHEEL_SETTLE_MS));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(54);
  });

  it("steps through named options, and does nothing while disabled", () => {
    const commit = vi.fn();
    render(
      <Held
        label="Wave"
        start={0}
        min={0}
        max={2}
        options={["Saw", "Square", "Tri"]}
        spy={commit}
      />,
    );
    const el = dial("Wave");
    expect(el.getAttribute("aria-valuetext")).toBe("Saw");
    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(commit).toHaveBeenLastCalledWith(1);
    expect(el.getAttribute("aria-valuetext")).toBe("Square");
    cleanup();
    commit.mockClear();
    render(<Knob label="Cutoff" value={3} min={0} max={10} disabled onCommit={commit} />);
    const off = dial();
    expect(off.getAttribute("aria-disabled")).toBe("true");
    expect(off.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(off, { key: "End" });
    drag(off, 300, 100);
    fireEvent.doubleClick(off);
    expect(commit).not.toHaveBeenCalled();
  });
});

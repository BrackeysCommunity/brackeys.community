// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { settingsRows } from "../../../../editor/settings-model";
import { DraftInput, isBoundedNumber, SliderField, type FieldCommit } from "../field-widgets";

const SCHEMA = z.object({
  gain: z.number().min(0).max(1).optional().meta({ default: 0.5 }),
  rate: z.number().min(0.5).max(2).optional(),
  free: z.number().min(0).optional(),
  order: z.number().int().min(-10_000).max(10_000).optional(),
});
const row = (name: string, value: Record<string, unknown> = {}) =>
  settingsRows(SCHEMA, value, "").find((r) => r.name === name)!;
const range = (label: string) =>
  document.querySelector(`input[type="range"][aria-label="${label} slider"]`)!;

describe("SliderField", () => {
  afterEach(cleanup);

  it("takes only a number with both a least and a most value", () => {
    expect(isBoundedNumber(row("gain"))).toBe(true);
    expect(isBoundedNumber(row("free"))).toBe(false);
  });

  it("leaves a range too many steps wide for a slider to the typed box", () => {
    expect(isBoundedNumber(row("order"))).toBe(false);
  });

  it("sits an unset field at its schema default and says so", () => {
    render(<SliderField field={row("gain")} commit={vi.fn<FieldCommit>(() => null)} />);
    expect(range("Gain").getAttribute("aria-valuenow")).toBe("0.5");
    expect((screen.getByRole("textbox", { name: "Gain" }) as HTMLInputElement).placeholder).toBe(
      "0.5 (default)",
    );
  });

  it("sits an unset field with no default at the end of its range nearest 0", () => {
    render(<SliderField field={row("rate")} commit={vi.fn<FieldCommit>(() => null)} />);
    expect(range("Rate").getAttribute("aria-valuenow")).toBe("0.5");
    expect((screen.getByRole("textbox", { name: "Rate" }) as HTMLInputElement).placeholder).toBe(
      "unset",
    );
  });

  it("commits a typed value, and empty unsets an optional field", () => {
    const commit = vi.fn<FieldCommit>(() => null);
    render(<SliderField field={row("gain", { gain: 0.2 })} commit={commit} />);
    const box = screen.getByRole("textbox", { name: "Gain" });
    fireEvent.change(box, { target: { value: "0.7" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(commit).toHaveBeenLastCalledWith("0.7");
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(commit).toHaveBeenLastCalledWith(undefined);
  });
});

describe("DraftInput", () => {
  afterEach(cleanup);

  it("commits a changed draft on Enter or blur and drops it on Escape", () => {
    const onCommit = vi.fn();
    render(<DraftInput label="title" value="Yard" size="sm" onCommit={onCommit} />);
    const box = screen.getByRole("textbox", { name: "title" }) as HTMLInputElement;
    expect(box.dataset.size).toBe("sm");

    fireEvent.change(box, { target: { value: "Cellar" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("Yard");
    fireEvent.blur(box);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: "Cellar" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith("Cellar", "enter");

    fireEvent.change(box, { target: { value: "Attic" } });
    fireEvent.blur(box);
    expect(onCommit).toHaveBeenLastCalledWith("Attic", "blur");
  });

  it("commits nothing when the draft is the value unchanged", () => {
    const onCommit = vi.fn();
    render(<DraftInput label="title" value="Yard" onCommit={onCommit} />);
    const box = screen.getByRole("textbox", { name: "title" });
    fireEvent.change(box, { target: { value: "Yard" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });
});

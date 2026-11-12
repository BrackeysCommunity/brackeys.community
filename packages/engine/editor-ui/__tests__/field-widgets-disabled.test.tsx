// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { settingsRows } from "../../editor/settings-model";
import { AngleField, NumberField, type FieldCommit } from "../panels/inspector/field-widgets";

const SCHEMA = z.object({
  width: z.number().optional().meta({ unit: "px" }),
  heading: z.number().optional().meta({ unit: "deg" }),
});
const row = (name: string) =>
  settingsRows(SCHEMA, { width: 32, heading: 0 }, "").find((r) => r.name === name)!;

/** Drags `el` 200 px to the right with the primary button. */
function drag(el: Element) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200, clientY: 0 });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 200, clientY: 0 });
}

const dialOf = (container: HTMLElement) => container.querySelector(".je-insp-dial")!;

afterEach(cleanup);

describe("a number or angle field that takes no edits", () => {
  it("scrubs its number by dragging the label while enabled", () => {
    const commit = vi.fn<FieldCommit>(() => null);
    render(<NumberField field={row("width")} commit={commit} />);
    const label = screen.getByText(row("width").title);
    expect(label.classList.contains("je-insp-scrub")).toBe(true);
    drag(label);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("drops the scrub from its label when disabled", () => {
    const commit = vi.fn<FieldCommit>(() => null);
    render(<NumberField field={row("width")} commit={commit} disabled />);
    const label = screen.getByText(row("width").title);
    expect(label.classList.contains("je-insp-scrub")).toBe(false);
    drag(label);
    expect(commit).not.toHaveBeenCalled();
  });

  it("doesn't scrub inside a disabled fieldset", () => {
    const commit = vi.fn<FieldCommit>(() => null);
    render(
      <fieldset disabled>
        <NumberField field={row("width")} commit={commit} />
      </fieldset>,
    );
    drag(screen.getByText(row("width").title));
    expect(commit).not.toHaveBeenCalled();
  });

  it("turns its dial while enabled, and not when disabled or inside a disabled fieldset", () => {
    const commit = vi.fn<FieldCommit>(() => null);
    const live = render(<AngleField field={row("heading")} commit={commit} />);
    const dial = dialOf(live.container);
    dial.getBoundingClientRect = () => new DOMRect(0, 0, 20, 20);
    fireEvent.pointerDown(dial, { pointerId: 1, clientX: 10, clientY: 30 });
    fireEvent.pointerUp(dial, { pointerId: 1 });
    expect(commit).toHaveBeenCalledTimes(1);
    cleanup();

    for (const tree of [
      <AngleField key="off" field={row("heading")} commit={commit} disabled />,
      <fieldset key="set" disabled>
        <AngleField field={row("heading")} commit={commit} />
      </fieldset>,
    ]) {
      const { container } = render(tree);
      const off = dialOf(container);
      off.getBoundingClientRect = () => new DOMRect(0, 0, 20, 20);
      fireEvent.pointerDown(off, { pointerId: 1, clientX: 10, clientY: 30 });
      fireEvent.pointerUp(off, { pointerId: 1 });
      cleanup();
    }
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

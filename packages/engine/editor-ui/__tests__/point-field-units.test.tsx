// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { settingsRows } from "../../editor/settings-model";
import { KitProvider } from "../kit/index";
import { PointField } from "../panels/inspector/field-widgets";

const rowOf = (field: z.ZodType, value?: unknown) =>
  settingsRows(z.object({ field }), value === undefined ? {} : { field: value }, "")[0]!;

afterEach(cleanup);

describe("a point field's unit", () => {
  it("shows none for a pair that declares none, and steps as a plain number", () => {
    const commitEach = vi.fn((next: (current: unknown) => unknown) => {
      const out = next([0.5, 0.5]);
      return out instanceof Object && "message" in out ? "refused" : null;
    });
    const { container } = render(
      <KitProvider host={{}}>
        <PointField
          field={rowOf(z.tuple([z.number(), z.number()]), [0.5, 0.5])}
          commitEach={commitEach}
        />
      </KitProvider>,
    );
    expect(container.querySelector(".je-insp-line.je-insp-suffix")).toBeNull();
    const x = screen.getByRole("textbox", { name: "field.x" });
    fireEvent.keyDown(x, { key: "ArrowUp" });
    const next = commitEach.mock.calls[0]![0];
    expect(next([0.5, 0.5])).toEqual([0.6, 0.5]);
  });

  it("keeps a declared unit, metric or not", () => {
    const { container } = render(
      <KitProvider host={{}}>
        <PointField
          field={rowOf(z.tuple([z.number(), z.number()]).meta({ unit: "m" }))}
          commitEach={() => null}
        />
      </KitProvider>,
    );
    expect(container.querySelector(".je-insp-line.je-insp-suffix")?.textContent).toBe("m");
  });
});

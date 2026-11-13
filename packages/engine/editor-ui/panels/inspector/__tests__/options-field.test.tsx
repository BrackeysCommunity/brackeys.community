// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { settingsRows } from "../../../../editor/settings-model";
import { OptionsField, type FieldCommit } from "../field-widgets";

const SCHEMA = z.object({
  kind: z.enum(["directional", "point"]).optional(),
  mode: z.enum(["calm", "wild"]).optional(),
});
const row = (name: string, value: Record<string, unknown> = {}) =>
  settingsRows(SCHEMA, value, "").find((r) => r.name === name)!;
const kind = () => ({ ...row("kind"), defaultValue: "directional" });
const OPTIONS = [
  { value: "directional", label: "directional", description: "Pushes one way" },
  { value: "point", label: "point" },
];

describe("OptionsField", () => {
  afterEach(cleanup);

  it("marks an unset segmented choice's default by its tint and tooltip, with no note beside it", async () => {
    vi.useFakeTimers();
    try {
      const commit = vi.fn<FieldCommit>(() => null);
      render(<OptionsField field={kind()} commit={commit} options={OPTIONS} segmented />);
      expect(screen.queryByText(/\(default\)/)).toBeNull();
      const choice = screen.getByRole("button", { name: "directional" });
      expect(choice.classList.contains("je-insp-default-choice")).toBe(true);
      expect(
        screen.getByRole("button", { name: "point" }).classList.contains("je-insp-default-choice"),
      ).toBe(false);
      fireEvent.pointerEnter(choice, { pointerType: "mouse" });
      fireEvent.mouseEnter(choice);
      fireEvent.mouseMove(choice);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText("Pushes one way (default)")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the note for an unset segmented field whose default matches no option", () => {
    const commit = vi.fn<FieldCommit>(() => null);
    render(
      <OptionsField
        field={row("mode")}
        commit={commit}
        unset="calm (default)"
        options={[
          { value: "calm", label: "calm" },
          { value: "wild", label: "wild" },
        ]}
        segmented
      />,
    );
    expect(screen.getByText("calm (default)")).toBeTruthy();
  });

  it("names the default in a select's trigger", () => {
    const commit = vi.fn<FieldCommit>(() => null);
    render(<OptionsField field={kind()} commit={commit} options={OPTIONS} segmented={false} />);
    expect(screen.getByRole("combobox", { name: "kind" }).textContent).toBe(
      "directional (default)",
    );
  });
});

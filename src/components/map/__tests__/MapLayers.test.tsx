// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_LAYERS,
  LIVE_LAYERS,
  type LayerId,
} from "../../../../packages/mmo-map/src/index.ts";
import { MAP_LAYER_NAMES } from "../../../../packages/mmo-words/src/index.ts";
import { MapLayers } from "../MapLayers";

afterEach(cleanup);

const toggle = (id: LayerId) => screen.getByRole("button", { name: MAP_LAYER_NAMES[id] });
const isDisabled = (el: HTMLElement) =>
  el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";

describe("MapLayers", () => {
  it("disables every live layer for an anonymous viewer, and says why", () => {
    render(<MapLayers layers={DEFAULT_LAYERS} onChange={() => {}} viewer="anonymous" />);
    for (const id of LIVE_LAYERS) {
      expect(isDisabled(toggle(id))).toBe(true);
      expect(toggle(id).getAttribute("aria-pressed")).toBe("false");
    }
    expect(isDisabled(toggle("terrain"))).toBe(false);
    expect(screen.getByRole("button", { name: "Why live layers are off" })).toBeTruthy();
  });

  it("disables live layers for a signed-in viewer with no character", () => {
    render(<MapLayers layers={DEFAULT_LAYERS} onChange={() => {}} viewer="player" />);
    for (const id of LIVE_LAYERS) expect(isDisabled(toggle(id))).toBe(true);
  });

  it("lets a character toggle live layers", () => {
    const onChange = vi.fn();
    render(<MapLayers layers={DEFAULT_LAYERS} onChange={onChange} viewer="character" />);
    expect(isDisabled(toggle("threat"))).toBe(false);
    expect(toggle("threat").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Why live layers are off" })).toBeNull();
    fireEvent.click(toggle("threat"));
    const next = onChange.mock.calls[0]![0] as ReadonlySet<string>;
    expect(next.has("threat")).toBe(false);
    expect(next.has("terrain")).toBe(true);
  });

  it("toggles a base layer for anyone", () => {
    const onChange = vi.fn();
    render(<MapLayers layers={DEFAULT_LAYERS} onChange={onChange} viewer="anonymous" />);
    fireEvent.click(toggle("roads"));
    const next = onChange.mock.calls[0]![0] as ReadonlySet<string>;
    expect(next.has("roads")).toBe(false);
    expect(next.has("threat")).toBe(true);
  });
});

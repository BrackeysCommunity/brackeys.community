import { cleanup, fireEvent, render } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { HoverPlayImage } from "@/components/ui/hover-play-image";

// The transformer gate (VITE_CF_IMAGES) is off in tests, so no frozen URL
// twin exists — exactly the environment the canvas fallback is for.

const GIF = "https://img.itch.zone/abc/original/banner.gif";
const PNG = "https://img.itch.zone/abc/original/banner.png";

afterEach(cleanup);

describe("HoverPlayImage", () => {
  it("renders a plain img for non-animated sources", () => {
    const { container } = render(<HoverPlayImage src={PNG} transform={{ width: 480 }} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(PNG);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("freezes a gif to a canvas when no still twin exists", () => {
    const { container } = render(<HoverPlayImage src={GIF} transform={{ width: 480 }} />);
    expect(container.querySelector("canvas")).not.toBeNull();
    // The animated source must not be mounted while idle.
    expect(container.querySelector("img")).toBeNull();
  });

  it("plays the gif over the canvas on hover and stops on leave", () => {
    const { container } = render(<HoverPlayImage src={GIF} transform={{ width: 480 }} />);
    const canvas = container.querySelector("canvas")!;

    fireEvent.pointerEnter(canvas);
    const overlay = container.querySelector("img");
    expect(overlay?.getAttribute("src")).toBe(GIF);

    fireEvent.pointerLeave(canvas);
    expect(container.querySelector("img")).toBeNull();
  });

  it("hides the still only once the playing copy has loaded", () => {
    const { container } = render(<HoverPlayImage src={GIF} transform={{ width: 480 }} />);
    const canvas = container.querySelector("canvas")!;

    fireEvent.pointerEnter(canvas);
    // Overlay mounted but not loaded — the still must stay visible.
    expect(canvas.className).not.toContain("opacity-0");

    fireEvent.load(container.querySelector("img")!);
    expect(canvas.className).toContain("opacity-0");

    // Leaving restores the still for the next hover.
    fireEvent.pointerLeave(canvas);
    expect(canvas.className).not.toContain("opacity-0");
  });

  it("plays from anywhere over a data-hover-play-group ancestor", () => {
    const { container } = render(
      <div data-hover-play-group>
        <HoverPlayImage src={GIF} transform={{ width: 480 }} />
        <span>title</span>
      </div>,
    );
    const group = container.firstElementChild!;

    fireEvent.pointerEnter(group);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(GIF);

    // Crossing off the art onto the card's text keeps it playing — only
    // leaving the group ends it.
    fireEvent.pointerLeave(container.querySelector("canvas")!, {
      relatedTarget: container.querySelector("span"),
    });
    expect(container.querySelector("img")).not.toBeNull();

    fireEvent.pointerLeave(group);
    expect(container.querySelector("img")).toBeNull();
  });
});

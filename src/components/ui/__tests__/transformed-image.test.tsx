import { cleanup, fireEvent, render } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const SRC = "https://cdn.discordapp.com/avatars/1/abc.png";
const TRANSFORMED = `/cdn-cgi/image/width=224,quality=60,format=auto,fit=scale-down,onerror=redirect/${SRC}`;

// @/env reads the gate once at import, so the module graph is reloaded per
// test with VITE_CF_IMAGES stubbed on.
async function loadTransformedImage() {
  vi.resetModules();
  return (await import("@/components/ui/transformed-image")).TransformedImage;
}

/** What the DOM reports for an image whose request has already failed. */
function markBroken(img: HTMLImageElement) {
  Object.defineProperty(img, "complete", { configurable: true, value: true });
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: 0 });
}

beforeEach(() => {
  vi.stubEnv("VITE_CF_IMAGES", "1");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("TransformedImage", () => {
  it("renders the transformed source", async () => {
    const TransformedImage = await loadTransformedImage();
    const { container } = render(<TransformedImage src={SRC} transform={{ width: 224 }} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(TRANSFORMED);
  });

  it("falls back to the plain source when the transform errors", async () => {
    const TransformedImage = await loadTransformedImage();
    const { container } = render(<TransformedImage src={SRC} transform={{ width: 224 }} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(SRC);
  });

  it("falls back for a transform that failed before the handler was attached", async () => {
    const TransformedImage = await loadTransformedImage();
    // The server-rendered case: the browser requested and was refused the
    // transform during parse, so no `error` event is left to receive.
    const proto = window.HTMLImageElement.prototype;
    const spy = vi.spyOn(proto, "setAttribute").mockImplementation(function (
      this: HTMLImageElement,
      name: string,
      value: string,
    ) {
      Object.getPrototypeOf(proto).setAttribute.call(this, name, value);
      if (name === "src" && value === TRANSFORMED) markBroken(this);
    });

    const { container } = render(<TransformedImage src={SRC} transform={{ width: 224 }} />);
    spy.mockRestore();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(SRC);
  });

  it("reports to the caller only once the plain source has failed too", async () => {
    const TransformedImage = await loadTransformedImage();
    const onError = vi.fn();
    const { container } = render(
      <TransformedImage src={SRC} transform={{ width: 224 }} onError={onError} />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(onError).not.toHaveBeenCalled();
    fireEvent.error(container.querySelector("img")!);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

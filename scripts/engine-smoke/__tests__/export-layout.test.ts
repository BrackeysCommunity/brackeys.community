import { describe, expect, it } from "vite-plus/test";

import { judgeLayout, judgeRun, type PageLayout, type RunObservation } from "../export";

const WINDOW = { innerWidth: 1024, innerHeight: 768 };
const filled: PageLayout = {
  ...WINDOW,
  scrollWidth: 1024,
  scrollHeight: 768,
  canvas: { top: 0, left: 0, width: 1024, height: 768 },
};

describe("judgeLayout", () => {
  it("passes a canvas that fills the window with nothing to scroll", () => {
    expect(judgeLayout(filled)).toBeNull();
  });

  it("fails the default body margin: a framed canvas and a page that scrolls", () => {
    const framed: PageLayout = {
      ...WINDOW,
      scrollWidth: 1024,
      scrollHeight: 784,
      canvas: { top: 8, left: 8, width: 1008, height: 768 },
    };
    const reason = judgeLayout(framed)!;
    expect(reason).toContain("the page scrolls: 1024×784 in a 1024×768 window");
    expect(reason).toContain("the canvas is 1008×768 at 8,8");
  });

  it("fails a page with no canvas", () => {
    expect(judgeLayout({ ...filled, canvas: null })).toBe("the page has no canvas");
  });

  it("joins a run's reasons", () => {
    const observed: RunObservation = {
      requests: [],
      failed: [],
      origin: "http://127.0.0.1:1",
      mount: "/",
      pwa: true,
      serviceWorkers: 0,
      play: {} as RunObservation["play"],
      playReason: null,
      layout: { ...filled, scrollHeight: 800 },
    };
    expect(judgeRun("play", observed)).toEqual(["the page scrolls: 1024×800 in a 1024×768 window"]);
  });
});

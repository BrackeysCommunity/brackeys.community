// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { ScrambleText } from "@/components/ui/scramble-text";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

/**
 * The loop used to re-schedule itself forever — including while `active`
 * was false and after every character had revealed — rewriting
 * `textContent` on every span each frame and forcing a layout pass with it.
 * At idle on `/` that was the single largest source of DOM churn.
 */

let frames: Map<number, (t: number) => void>;
let nextFrameId: number;

/** Runs the pending frame callbacks at `now`, returning how many ran. */
function flushFrame(now: number) {
  const due = Array.from(frames.values());
  frames = new Map();
  act(() => {
    for (const cb of due) cb(now);
  });
  return due.length;
}

function installRaf() {
  frames = new Map();
  nextFrameId = 1;
  window.requestAnimationFrame = ((cb: (t: number) => void) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    frames.delete(id);
  }) as typeof window.cancelAnimationFrame;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function renderScramble(ui: React.ReactElement) {
  return render(<AppSettingsProvider>{ui}</AppSettingsProvider>);
}

function glyphs(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-scramble-char]"))
    .map((span) => span.textContent)
    .join("");
}

describe("ScrambleText", () => {
  beforeEach(installRaf);
  afterEach(() => {
    frames = new Map();
  });

  it("stops scheduling frames once every character has revealed", () => {
    const { container } = renderScramble(<ScrambleText duration={0.5}>BUILD</ScrambleText>);

    expect(frames.size).toBe(1);
    flushFrame(0);
    expect(glyphs(container)).not.toBe("BUILD");

    // Past the 0.5s duration: the final glyphs land and the loop ends.
    flushFrame(600);
    expect(glyphs(container)).toBe("BUILD");
    expect(flushFrame(700)).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("never starts a loop when inactive", () => {
    const { container } = renderScramble(
      <ScrambleText active={false} duration={Infinity}>
        BUILD
      </ScrambleText>,
    );

    expect(frames.size).toBe(0);
    expect(glyphs(container)).toBe("BUILD");
  });

  it("treats reduced motion as inactive", () => {
    window.localStorage.setItem("brackeys-reduce-motion", "1");
    try {
      const { container } = renderScramble(<ScrambleText duration={Infinity}>BUILD</ScrambleText>);
      expect(frames.size).toBe(0);
      expect(glyphs(container)).toBe("BUILD");
    } finally {
      window.localStorage.removeItem("brackeys-reduce-motion");
    }
  });

  it("keeps running while a character is still scrambling", () => {
    renderScramble(<ScrambleText duration={Infinity}>BUILD</ScrambleText>);

    flushFrame(0);
    expect(frames.size).toBe(1);
    flushFrame(100);
    expect(frames.size).toBe(1);
  });
});

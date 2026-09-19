import * as React from "react";

import { useOptionalAppSettings } from "@/lib/hooks/use-app-settings";
import { cn } from "@/lib/utils";

const DEFAULT_CHARS = "■□▲△◆◇●◼●○◎◉◌●•⋱⋰⋮⋯⋆⋇⋈∘☉☀☼▪▫●‣⁃◦▣▦▧▨▩▭▰▱▬▭◢◣◤◥!@#%^*[]-_=+\\|/";

/** How often a scrambling character picks a new glyph. Slower than a frame. */
const SCRAMBLE_MIN_CYCLE_MS = 30;

interface StaggerOptions {
  startDelay?: number;
  from?: "first" | "last" | "center";
}

type StaggerFn = (index: number, count: number) => number;

/**
 * Creates a per-character stagger function compatible with ScrambleText's
 * `delay` and `duration` props. Mirrors the Motion+ `stagger()` API.
 */
export const stagger =
  (increment: number, options?: StaggerOptions): StaggerFn =>
  (index, count) => {
    const { startDelay = 0, from = "first" } = options ?? {};
    let i = index;
    if (from === "last") i = count - 1 - index;
    else if (from === "center") i = Math.abs(index - (count - 1) / 2);
    return startDelay + i * increment;
  };

interface ScrambleTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: string;
  /** Toggle scrambling on/off. When false, characters reveal immediately. */
  active?: boolean;
  /**
   * How long (in seconds) each character scrambles before revealing.
   * Pass `Infinity` to scramble forever while `active` is true.
   * Pass a `stagger()` function for per-character durations.
   */
  duration?: number | StaggerFn;
  /**
   * Delay (in seconds) before each character starts scrambling.
   * Pass a `stagger()` function for per-character delays.
   */
  delay?: number | StaggerFn;
  /** Characters used for scrambling. Defaults to alphanumeric set. */
  chars?: string;
}

export function ScrambleText({
  children,
  active = true,
  duration = 1,
  delay = 0,
  chars = DEFAULT_CHARS,
  className,
  ...props
}: ScrambleTextProps) {
  const containerRef = React.useRef<HTMLSpanElement>(null);
  const rafRef = React.useRef<number | null>(null);

  // Optional so the component still renders outside the settings provider.
  const reduced = useOptionalAppSettings()?.reduceMotion ?? false;
  const scrambling = active && !reduced;

  // Stable ref for the values the loop reads but must not restart on —
  // `stagger()` callers build a new function every render.
  const timingRef = React.useRef({ duration, delay });
  React.useEffect(() => {
    timingRef.current = { duration, delay };
  });

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const spans = container.querySelectorAll<HTMLSpanElement>("[data-scramble-char]");
    const textChars = Array.from(children);
    const count = textChars.length;

    const write = (span: HTMLSpanElement, char: string) => {
      // Writing an unchanged textContent still invalidates layout.
      if (span.textContent !== char) span.textContent = char;
    };

    const settle = () => {
      textChars.forEach((char, i) => {
        const span = spans[i];
        if (span) write(span, char);
      });
    };

    if (!scrambling) {
      settle();
      return;
    }

    const getRandomChar = (charSet: string) => {
      const arr = Array.from(charSet);
      return arr[Math.floor(Math.random() * arr.length)];
    };

    const resolveValue = (val: number | StaggerFn, index: number, count: number) =>
      typeof val === "function" ? val(index, count) : val;

    let startTime: number | null = null;
    let lastUpdate = 0;

    const tick = (timestamp: number) => {
      if (startTime === null) {
        startTime = timestamp;
        lastUpdate = timestamp;
      }

      if (timestamp - lastUpdate < SCRAMBLE_MIN_CYCLE_MS && timestamp !== startTime) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastUpdate = timestamp;

      const elapsed = (timestamp - startTime) / 1000;
      const { duration: dur, delay: del } = timingRef.current;
      let pending = false;

      textChars.forEach((char, index) => {
        const span = spans[index];
        if (!span) return;

        if (char === " " || char === "\n") {
          write(span, char);
          return;
        }

        const charDelay = resolveValue(del, index, count);
        const charDuration = resolveValue(dur, index, count);

        if (charDuration !== Infinity && elapsed - charDelay >= charDuration) {
          write(span, char);
          return;
        }

        pending = true;
        span.textContent = getRandomChar(chars);
      });

      // Every character has landed on its final glyph: nothing left to draw
      // until `children` or `active` changes, which restarts this effect.
      if (!pending) {
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [children, scrambling, chars]);

  const originalChars = Array.from(children);

  return (
    <span className={cn(className)} {...props}>
      {/* Screen reader text — always shows the real content */}
      <span className="sr-only">{children}</span>
      {/* Visually scrambled characters, hidden from assistive tech */}
      <span ref={containerRef} aria-hidden="true">
        {originalChars.map((char, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: scramble chars are positional
          <span key={i} data-scramble-char>
            {char}
          </span>
        ))}
      </span>
    </span>
  );
}

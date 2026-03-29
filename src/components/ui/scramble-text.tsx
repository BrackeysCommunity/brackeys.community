import * as React from 'react';
import { cn } from '@/lib/utils';

const DEFAULT_CHARS = "■□▲△◆◇●◼●○◎◉◌●•⋱⋰⋮⋯⋆⋇⋈∘☉☀☼▪▫●‣⁃◦▣▦▧▨▩▭▰▱▬▭◢◣◤◥!@#%^*[]-_=+\\|/";

interface StaggerOptions {
  startDelay?: number;
  from?: 'first' | 'last' | 'center';
}

type StaggerFn = (index: number, count: number) => number;

/**
 * Creates a per-character stagger function compatible with ScrambleText's
 * `delay` and `duration` props. Mirrors the Motion+ `stagger()` API.
 */
export const stagger = (increment: number, options?: StaggerOptions): StaggerFn =>
  (index, count) => {
    const { startDelay = 0, from = 'first' } = options ?? {};
    let i = index;
    if (from === 'last') i = count - 1 - index;
    else if (from === 'center') i = Math.abs(index - (count - 1) / 2);
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
  const startTimeRef = React.useRef<number | null>(null);

  // Slowness multiplier: scramble updates every X milliseconds (e.g., 40ms is slower than 16ms)
  const SCRAMBLE_MIN_CYCLE_MS = 30; // was 16ms for requestAnimationFrame; increase for slower effect
  const lastScrambleUpdateRef = React.useRef<number>(0);

  // Stable ref that always holds the latest props — read inside RAF without restarts
  const paramsRef = React.useRef({ children, active, duration, delay, chars });
  paramsRef.current = { children, active, duration, delay, chars };

  // Track previous children+active to know when to reset the animation clock
  const prevSnapshotRef = React.useRef(`${active}::${children}`);

  React.useEffect(() => {
    const getRandomChar = (charSet: string) => {
      const arr = Array.from(charSet);
      return arr[Math.floor(Math.random() * arr.length)];
    };

    const resolveValue = (val: number | StaggerFn, index: number, count: number) =>
      typeof val === 'function' ? val(index, count) : val;

    const tick = (timestamp: number) => {
      const container = containerRef.current;
      if (!container) return;

      const { children: text, active: isActive, chars: charSet, duration: dur, delay: del } = paramsRef.current;
      const snapshot = `${isActive}::${text}`;

      // Reset animation clock when active toggles on or text changes
      if (snapshot !== prevSnapshotRef.current) {
        startTimeRef.current = null;
        prevSnapshotRef.current = snapshot;
      }

      const spans = container.querySelectorAll<HTMLSpanElement>('[data-scramble-char]');

      if (!isActive) {
        Array.from(text).forEach((char, i) => {
          const span = spans[i];
          if (span) span.textContent = char;
        });
        startTimeRef.current = null;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
        lastScrambleUpdateRef.current = timestamp;
      }

      const elapsed = (timestamp - startTimeRef.current) / 1000;
      const textChars = Array.from(text);
      const count = textChars.length;

      // Control the "generation" rate of new random characters
      if (timestamp - lastScrambleUpdateRef.current >= SCRAMBLE_MIN_CYCLE_MS || elapsed === 0) {
        lastScrambleUpdateRef.current = timestamp;

        textChars.forEach((char, index) => {
          const span = spans[index];
          if (!span) return;

          if (char === ' ' || char === '\n') {
            span.textContent = char;
            return;
          }

          const charDelay = resolveValue(del, index, count);
          const charDuration = resolveValue(dur, index, count);

          if (elapsed < charDelay) {
            span.textContent = getRandomChar(charSet);
            return;
          }

          const charElapsed = elapsed - charDelay;

          if (charDuration === Infinity) {
            span.textContent = getRandomChar(charSet);
            return;
          }

          if (charElapsed >= charDuration) {
            span.textContent = char;
            return;
          }

          span.textContent = getRandomChar(charSet);
        });
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
  }, []);

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

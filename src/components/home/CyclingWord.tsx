import * as React from "react";

import { ScrambleText, stagger } from "@/components/ui/scramble-text";
import { useReducedMotion } from "@/lib/hooks/use-app-settings";

const WORDS = ["MAKE", "DESIGN", "PRODUCE", "DEVELOP", "TEST", "CREATE", "PLAY", "BUILD"];

const STAGGER_INCREMENT = 0.15;
const START_DELAY = 0.3;
const HOLD_AFTER_REVEAL_MS = 1500;

/** `useLayoutEffect` that stays quiet on the server. */
const useIsoLayoutEffect =
  typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;

interface CyclingWordProps {
  className?: string;
}

export function CyclingWord({ className }: CyclingWordProps) {
  const reduced = useReducedMotion();
  const [index, setIndex] = React.useState(0);

  // Randomize the starting word per page load — reduced-motion visitors see
  // a single static word, so this is their only variety. Done in an effect
  // rather than the initializer so the server and client first renders
  // agree; a layout effect so the swap lands before paint.
  useIsoLayoutEffect(() => {
    setIndex(Math.floor(Math.random() * WORDS.length));
  }, []);

  // Each word has a different length, so we calculate per-word reveal time
  // and add a fixed hold period before transitioning to the next word.
  React.useEffect(() => {
    if (reduced) return;
    const word = WORDS[index];
    const revealMs = (START_DELAY + (word.length - 1) * STAGGER_INCREMENT) * 2000;
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % WORDS.length);
    }, revealMs + HOLD_AFTER_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [index, reduced]);

  return (
    <ScrambleText
      active={!reduced}
      duration={stagger(STAGGER_INCREMENT, { startDelay: START_DELAY })}
      className={`whitespace-nowrap${className ? ` ${className}` : ""}`}
    >
      {WORDS[index]}
    </ScrambleText>
  );
}

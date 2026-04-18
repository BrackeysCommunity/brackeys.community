import * as React from "react";

import { ScrambleText, stagger } from "@/components/ui/scramble-text";

const WORDS = ["MAKE", "DESIGN", "PRODUCE", "DEVELOP", "TEST", "CREATE", "PLAY", "BUILD"];

const STAGGER_INCREMENT = 0.15;
const START_DELAY = 0.3;
const HOLD_AFTER_REVEAL_MS = 1500;

interface CyclingWordProps {
  className?: string;
}

export function CyclingWord({ className }: CyclingWordProps) {
  const [index, setIndex] = React.useState(0);

  // Each word has a different length, so we calculate per-word reveal time
  // and add a fixed hold period before transitioning to the next word.
  React.useEffect(() => {
    const word = WORDS[index];
    const revealMs = (START_DELAY + (word.length - 1) * STAGGER_INCREMENT) * 2000;
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % WORDS.length);
    }, revealMs + HOLD_AFTER_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [index]);

  return (
    <ScrambleText
      duration={stagger(STAGGER_INCREMENT, { startDelay: START_DELAY })}
      className={`whitespace-nowrap${className ? ` ${className}` : ""}`}
    >
      {WORDS[index]}
    </ScrambleText>
  );
}

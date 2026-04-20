import { useCountDown } from "ahooks";

import useDateNow from "@/lib/hooks/use-date-now";
import { cn } from "@/lib/utils";

interface CountdownProps {
  targetDate: Date;
  precision?: "dhm" | "dhms";
  className?: string;
}

export function Countdown({ targetDate, precision = "dhm", className }: CountdownProps) {
  const [, { days, hours, minutes, seconds }] = useCountDown({ targetDate });
  const timeNow = useDateNow();

  const isOver = timeNow >= targetDate.getTime();
  if (isOver) {
    return (
      <span
        className={cn(
          "font-mono text-4xl font-bold tracking-tight text-muted-foreground tabular-nums",
          className,
        )}
      >
        JAM ENDED
      </span>
    );
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const parts =
    precision === "dhm"
      ? [`${pad(days)}D`, `${pad(hours)}H`, `${pad(minutes)}M`]
      : [`${pad(days)}D`, pad(hours), pad(minutes), pad(seconds)];

  return (
    <span
      className={cn(
        "font-mono text-5xl font-bold tracking-tight text-brackeys-yellow tabular-nums sm:text-6xl",
        className,
      )}
    >
      {parts.join(" : ")}
    </span>
  );
}

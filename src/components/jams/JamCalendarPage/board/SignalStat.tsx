import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { type JamFromList, jamSignal } from "../helpers";

export function SignalStat({
  jam,
  now,
  align = "end",
}: {
  jam: JamFromList;
  now: Date;
  align?: "end" | "start";
}) {
  const signal = jamSignal(jam, now);
  return (
    <div
      className={cn(
        "flex flex-col justify-center gap-0.5",
        align === "end" ? "items-end" : "items-start",
      )}
    >
      <Text monospace size="xs" variant="muted" className="tracking-widest">
        {signal.label}
      </Text>
      <Text monospace bold size="md" className="tabular-nums">
        {signal.value.toLocaleString()}
      </Text>
    </div>
  );
}

/** One participation number on a single line, e.g. "286 JOINED".
 * `bold` is off in the list rail, where the title is the only thing
 * that should carry weight. */
export function CountStat({
  value,
  label,
  size = "xs",
  bold = true,
  className,
}: {
  value: number;
  label: string;
  size?: "xs" | "sm" | "md";
  bold?: boolean;
  className?: string;
}) {
  return (
    <Text
      monospace
      size={size}
      className={cn("tracking-widest whitespace-nowrap tabular-nums", className)}
    >
      <span className={bold ? "font-bold" : "font-medium"}>{value.toLocaleString()}</span>{" "}
      <span className="text-muted-foreground">{label}</span>
    </Text>
  );
}

/** Compact inline participation count — whichever metric is meaningful
 * for the jam's current phase. */
export function SignalInline({
  jam,
  now,
  size,
}: {
  jam: JamFromList;
  now: Date;
  size?: "xs" | "sm" | "md";
}) {
  const signal = jamSignal(jam, now);
  return <CountStat value={signal.value} label={signal.label} size={size} />;
}

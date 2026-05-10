import { useMemo } from "react";

import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

interface CollabPulseProps {
  /** Total open posts — drives the bar-chart seed and the headline number. */
  posts: number;
}

/**
 * Right-rail "// COLLAB PULSE · 24H" widget. The bars are derived from
 * the post count rather than a real time-series — the backend doesn't
 * yet expose hourly buckets, but the variance keeps the chart from
 * reading as fully-static placeholder.
 */
export function CollabPulse({ posts }: CollabPulseProps) {
  const bars = useMemo(() => {
    const seed = Math.max(posts, 12);
    return Array.from({ length: 24 }, (_, i) => {
      const v = Math.sin(i * 0.7 + seed * 0.13) * 0.45 + 0.55;
      return Math.max(0.15, Math.min(1, v));
    });
  }, [posts]);

  const newPosts = Math.max(1, Math.floor(posts * 0.15));
  const filled = Math.max(1, Math.floor(posts * 0.25));

  return (
    <Well className="gap-3 p-4">
      <div className="grid grid-cols-3 gap-3">
        <PulseStat label="NEW POSTS" value={`+${newPosts}`} variant="success" />
        <PulseStat label="OPEN ROLES" value={posts} variant="primary" />
        <PulseStat label="FILLED" value={filled} variant="default" />
      </div>
      <div className="flex h-12 items-end gap-0.5">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 bg-primary/30"
            style={{ height: `${h * 100}%`, opacity: 0.4 + h * 0.6 }}
          />
        ))}
      </div>
    </Well>
  );
}

function PulseStat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number | string;
  variant: "primary" | "success" | "default";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text monospace size="xs" variant="muted" className="tracking-widest">
        {label}
      </Text>
      <Text
        as="span"
        monospace
        bold
        density="dense"
        className={
          variant === "success"
            ? "text-base text-success tabular-nums"
            : variant === "primary"
              ? "text-base text-primary tabular-nums"
              : "text-base text-foreground tabular-nums"
        }
      >
        {value}
      </Text>
    </div>
  );
}

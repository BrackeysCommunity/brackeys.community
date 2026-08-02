import { CountUp } from "@/components/ui/count-up";
import { formatCountdown } from "@/lib/jam-countdown";

interface JamCountdownProps {
  target: Date | string | null;
  now: Date;
  ended: boolean;
  className?: string;
}

/** Largest non-zero unit pair (d/h, h/m, or m alone) of a countdown, with
 * each numeric value count-animated rather than cross-faded. */
export function JamCountdown({ target, now, ended, className }: JamCountdownProps) {
  if (ended) return <div className={className}>—</div>;
  const parts = formatCountdown(target, now);
  if (!parts) return <div className={className}>—</div>;
  return (
    <div className={className}>
      {parts.d > 0 ? (
        <>
          <CountUp to={parts.d} duration={0.4} />
          <span>d </span>
          <CountUp to={parts.h} duration={0.4} />
          <span>h</span>
        </>
      ) : parts.h > 0 ? (
        <>
          <CountUp to={parts.h} duration={0.4} />
          <span>h </span>
          <CountUp to={parts.m} duration={0.4} />
          <span>m</span>
        </>
      ) : (
        <>
          <CountUp to={parts.m} duration={0.4} />
          <span>m</span>
        </>
      )}
    </div>
  );
}

import { CountUp } from "@/components/ui/count-up";

function countdownParts(target: Date | string | null | undefined, now: Date) {
  if (!target) return null;
  const t = typeof target === "string" ? new Date(target) : target;
  const ms = t.getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor(abs / 3_600_000) % 24;
  const m = Math.floor(abs / 60_000) % 60;
  return { d, h, m };
}

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
  const parts = countdownParts(target, now);
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

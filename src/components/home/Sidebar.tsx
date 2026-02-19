import { Share01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCountDown } from 'ahooks';
import { Button } from '@/components/ui/button';

// Feb 22, 2026 at 5:00 AM CST = 11:00 AM UTC
const JAM_DEADLINE = new Date('2026-02-22T11:00:00Z');

const deadlineLocalStr = JAM_DEADLINE.toLocaleString(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

export function Sidebar() {
  const [, { days, hours, minutes, seconds }] = useCountDown({ targetDate: JAM_DEADLINE });

  const countdownStr =
    days > 0
      ? `${days}D ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <div className="hidden lg:flex fixed right-6 top-24 z-40 w-72 flex-col border-2 border-muted bg-background/80 backdrop-blur-md">
      {/* Card header */}
      <div className="flex items-center justify-between border-b-2 border-muted bg-card/60 px-4 py-3">
        <span className="font-mono text-sm font-bold text-foreground">EVENT LOG</span>
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
          </span>
          <span className="animate-pulse font-mono text-xs font-bold text-destructive">LIVE JAM</span>
        </div>
      </div>

      {/* Jam image */}
      <div className="relative overflow-hidden border-b-2 border-muted max-h-32">
        <img
          alt="Strange Places theme"
          className="w-full h-full object-cover object-top grayscale transition-all hover:grayscale-0"
          src="https://img.itch.zone/aW1nLzI1NTk5ODA3LnBuZw==/original/vYJgdy.png"
        />
      </div>

      {/* Jam info */}
      <div className="flex flex-col gap-4 px-5 py-5 text-center">
        <p className="font-display text-2xl font-bold text-foreground leading-tight">
          BRACKEYS GAME JAM
          <br />
          2026.1
        </p>

        <div className="h-px w-full bg-muted/50" />

        <div>
          <h3 className="font-mono text-xs text-destructive mb-1">DEADLINE</h3>
          <p className="font-mono text-2xl text-foreground tabular-nums">{countdownStr}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">REMAINING</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">{deadlineLocalStr}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t-2 border-muted bg-card/60 px-5 py-4">
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            isMagnetic
            className="border-cyan-400/50 text-cyan-400 hover:bg-cyan-400 hover:text-black font-mono text-xs font-bold"
          >
            JOIN DISCORD
            <HugeiconsIcon icon={Share01Icon} size={14} className="ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}

import { Share01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCountDown } from 'ahooks';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Feb 22, 2026 at 5:00 AM CST = 11:00 AM UTC
const JAM_DEADLINE = new Date('2026-02-22T11:00:00Z');
const NOTCH_SIZE = 22;

const deadlineLocalStr = JAM_DEADLINE.toLocaleString(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const notchClip = `polygon(0 0, calc(100% - ${NOTCH_SIZE}px) 0, 100% ${NOTCH_SIZE}px, 100% 100%, 0 100%)`;
const notchClipInner = `polygon(0 0, calc(100% - ${NOTCH_SIZE - 2}px) 0, 100% ${NOTCH_SIZE - 2}px, 100% 100%, 0 100%)`;

export function Sidebar() {
  const [, { days, hours, minutes, seconds }] = useCountDown({ targetDate: JAM_DEADLINE });

  const countdownStr =
    days > 0
      ? `${days}D ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        className="w-full h-full bg-muted/60"
        style={{ clipPath: notchClip, padding: '2px' }}
      >
        <div
          className="flex flex-col justify-between w-full h-full bg-background/90 backdrop-blur-md relative"
          style={{ clipPath: notchClipInner }}
        >
          {/* Corner decorators */}
          <span className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-cyan-400/50 pointer-events-none" />
          <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-cyan-400/50 pointer-events-none" />
          {/* Notch corner accent line */}
          <svg
            aria-hidden="true"
            className="absolute top-0 right-0 pointer-events-none text-cyan-400/40"
            width={NOTCH_SIZE + 2}
            height={NOTCH_SIZE + 2}
            viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
            fill="none"
          >
            <line x1="0" y1="1" x2={NOTCH_SIZE + 1} y2={NOTCH_SIZE + 2} stroke="currentColor" strokeWidth="1" />
          </svg>

          {/* Card header */}
          <div className="flex items-center justify-between border-b border-muted/60 bg-card/40 px-4 py-2.5">
            <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Event Log</span>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
              </span>
              <span className="animate-pulse font-mono text-[10px] font-bold tracking-widest text-destructive">LIVE JAM</span>
            </div>
          </div>

          {/* Jam title above image */}
          <div className="px-5 pt-4 pb-3 text-center border-b border-muted/60 bg-card/20">
            <p className="font-display text-xl font-bold text-foreground leading-tight">
              BRACKEYS GAME JAM
              <br />
              2026.1
            </p>
          </div>

          {/* Jam image */}
          <div className="relative overflow-hidden border-b border-muted/60" style={{ minHeight: '110px' }}>
            <img
              alt="Strange Places theme art"
              className="w-full h-full object-cover object-top grayscale transition-all duration-500 hover:grayscale-0"
              src="https://img.itch.zone/aW1nLzI1NTk5ODA3LnBuZw==/original/vYJgdy.png"
            />
            <div
              className="absolute inset-0 pointer-events-none opacity-20"
              style={{
                background: 'linear-gradient(to bottom, rgba(255,255,255,0) 50%, rgba(0,0,0,0.4) 50%)',
                backgroundSize: '100% 4px',
              }}
            />
          </div>

          {/* Deadline info */}
          <div className="flex flex-col items-center gap-1.5 px-5 py-5 text-center">
            <h3 className="font-mono text-[10px] tracking-[0.2em] text-destructive uppercase">{'// Deadline'}</h3>
            <p className="font-mono text-3xl font-bold text-foreground tabular-nums tracking-tight">{countdownStr}</p>
            <p className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">Remaining</p>
            <p className="font-mono text-[9px] text-muted-foreground/40 mt-0.5">{deadlineLocalStr}</p>
          </div>

          {/* Footer */}
          <div className="border-t border-muted/60 bg-card/30 px-6 py-4">
            <a
              href="https://discord.gg/brackeys"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'w-full border-cyan-400/40 text-cyan-400 hover:bg-cyan-400/10 hover:border-cyan-400 font-mono text-[10px] font-bold tracking-widest uppercase justify-between',
              )}
            >
              Join Discord
              <HugeiconsIcon icon={Share01Icon} size={13} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

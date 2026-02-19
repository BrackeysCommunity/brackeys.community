import { useCountDown } from 'ahooks';
import { HeroSection } from '@/components/home/HeroSection';
import { Sidebar } from '@/components/home/Sidebar';
import { GridBackground } from '@/components/home/GridBackground';

const JAM_DEADLINE = new Date('2026-02-22T11:00:00Z');

export function HomePage() {
  const [, { days, hours, minutes, seconds }] = useCountDown({ targetDate: JAM_DEADLINE });

  const timeStr =
    days > 0
      ? `${days}D ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const ticker = `LIVE JAM IN PROGRESS: THEME IS STRANGE PLACES  ///  ${timeStr} REMAINING  ///  CHECK DISCORD FOR UPDATES  ///  `;

  return (
    <div className="flex-1 w-full bg-background text-foreground overflow-hidden relative flex flex-col">
      <GridBackground />

      <div
        className="absolute inset-0 pointer-events-none z-60 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))',
          backgroundSize: '100% 2px, 3px 100%',
        }}
      />

      <main className="relative z-10 flex flex-1 overflow-hidden">
        <HeroSection />
      </main>
      <Sidebar />

      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-primary z-50 overflow-hidden py-1 border-t-2 border-black">
        <div className="flex w-max animate-[marquee_20s_linear_infinite]">
          <span className="font-mono text-xs font-bold text-black uppercase whitespace-nowrap">
            {ticker}
          </span>
          <span className="font-mono text-xs font-bold text-black uppercase whitespace-nowrap" aria-hidden>
            {ticker}
          </span>
        </div>
      </div>
    </div>
  );
}

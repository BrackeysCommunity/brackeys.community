import { useCountDown } from 'ahooks';
import { HeroSection } from '@/components/home/HeroSection';
import { Sidebar } from '@/components/home/Sidebar';
import { usePageSidebar } from '@/lib/hooks/use-page-layout';

const JAM_DEADLINE = new Date('2026-02-22T11:00:00Z');

export function HomePage() {
  const [, { days, hours, minutes, seconds }] = useCountDown({ targetDate: JAM_DEADLINE });

  const timeStr =
    days > 0
      ? `${days}D ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const ticker = `LIVE JAM IN PROGRESS: THEME IS STRANGE PLACES  ///  ${timeStr} REMAINING  ///  CHECK DISCORD FOR UPDATES  ///  `;

  usePageSidebar(<Sidebar />);

  return (
    <div className="flex-1 h-full overflow-hidden relative flex flex-col">
      <div className="relative z-10 flex flex-1 overflow-hidden">
        <HeroSection />
      </div>

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

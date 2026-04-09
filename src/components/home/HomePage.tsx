import { useCountDown } from "ahooks";
import { useState } from "react";

import { HeroSection } from "@/components/home/HeroSection";
import { Sidebar } from "@/components/home/Sidebar";
import { usePageSidebar } from "@/lib/hooks/use-page-layout";

const JAM_DEADLINE = new Date("2026-02-22T11:00:00Z");

export function HomePage() {
  const [, { days, hours, minutes, seconds }] = useCountDown({ targetDate: JAM_DEADLINE });

  const timeStr =
    days > 0
      ? `${days}D ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const [isJamOver] = useState(() => Date.now() >= JAM_DEADLINE.getTime());
  const ticker = `LIVE JAM IN PROGRESS: THEME IS STRANGE PLACES  ///  ${timeStr} REMAINING  ///  CHECK DISCORD FOR UPDATES  ///  `;

  usePageSidebar(<Sidebar />, "content");

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-visible">
      <div className="relative z-10 flex flex-1 overflow-visible">
        <HeroSection />
      </div>

      {!isJamOver && (
        <div className="fixed right-0 bottom-0 left-0 z-50 overflow-hidden border-t-2 border-black bg-primary py-1 lg:hidden">
          <div className="flex w-max animate-[marquee_20s_linear_infinite]">
            <span className="font-mono text-xs font-bold whitespace-nowrap text-black uppercase">
              {ticker}
            </span>
            <span
              className="font-mono text-xs font-bold whitespace-nowrap text-black uppercase"
              aria-hidden
            >
              {ticker}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

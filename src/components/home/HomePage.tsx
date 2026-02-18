import { HomeHeader } from '@/components/home/HomeHeader';
import { HeroSection } from '@/components/home/HeroSection';
import { Sidebar } from '@/components/home/Sidebar';
import { GridBackground } from '@/components/home/GridBackground';
import { cn } from '@/lib/utils';

export function HomePage() {
  return (
    <div className="h-screen w-full bg-background text-foreground overflow-hidden relative font-sans">
      <div className="h-full w-full animate-[turnOn_0.4s_ease-out_forwards] origin-center overflow-hidden flex flex-col relative">
        <GridBackground />
        
        {/* Scanlines Overlay */}
        <div className="absolute inset-0 pointer-events-none z-[60] opacity-20" 
          style={{
            backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))',
            backgroundSize: '100% 2px, 3px 100%'
          }}
        />

        <HomeHeader />

        <main className="relative z-10 flex flex-1 overflow-hidden">
          <HeroSection />
          <Sidebar />
        </main>

        {/* Mobile Ticker */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-primary z-50 overflow-hidden py-1 border-t-2 border-black">
          <div className="whitespace-nowrap animate-[marquee_10s_linear_infinite] flex gap-8">
            <span className="font-mono text-xs font-bold text-black uppercase">/// LIVE JAM IN PROGRESS: THEME IS CHAOS /// 48 HOURS REMAINING /// CHECK DISCORD FOR UPDATES ///</span>
            <span className="font-mono text-xs font-bold text-black uppercase">/// LIVE JAM IN PROGRESS: THEME IS CHAOS /// 48 HOURS REMAINING /// CHECK DISCORD FOR UPDATES ///</span>
          </div>
        </div>
      </div>
    </div>
  );
}

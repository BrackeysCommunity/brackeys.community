import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Sidebar() {
  return (
    <div className="hidden w-2/5 flex-col border-l-2 border-muted bg-black/40 lg:flex relative">
      <div className="flex items-center justify-between border-b-2 border-muted bg-card p-4">
        <span className="font-mono text-sm font-bold text-foreground">EVENT LOG</span>
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75"></span>
            <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive"></span>
          </span>
          <span className="animate-pulse font-mono text-sm font-bold text-destructive">LIVE JAM</span>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden bg-background">
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="h-[300px] w-[300px] rounded-full border border-primary/20 bg-primary/5 blur-[100px]"></div>
        </div>

        <div className="absolute left-0 right-0 flex h-[200%] flex-col gap-8 animate-[marquee_15s_linear_infinite] py-8">
          {[1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-12 px-8 text-center opacity-80">
              <div>
                <h3 className="font-mono text-sm text-primary mb-2">CURRENT EVENT</h3>
                <p className="font-display text-5xl font-bold text-foreground leading-tight">BRACKEYS<br/>GAME JAM<br/>2024.1</p>
              </div>
              <div className="h-px w-full bg-muted/50"></div>
              <div>
                <h3 className="font-mono text-sm text-cyan-400 mb-2">THEME</h3>
                <p className="font-display text-4xl font-bold text-foreground">CHAOS</p>
              </div>
              <div className="h-px w-full bg-muted/50"></div>
              <div>
                <h3 className="font-mono text-sm text-destructive mb-2">DEADLINE</h3>
                <p className="font-mono text-3xl text-foreground">48:12:05</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">REMAINING</p>
              </div>
              <div className="h-px w-full bg-muted/50"></div>
              <div className="relative aspect-video w-full overflow-hidden border border-muted grayscale transition-all hover:grayscale-0">
                <img 
                  alt="Retro setup" 
                  className="h-full w-full object-cover opacity-60" 
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCaO8X72y8L8vJhXmZKREZ4MqL-f65g6JPjM0Qy5LXzhWoWry0m5ZhjGrKCfpnwV9vUvsrUoT4w5UFPmdlgd8YPmy7m2_Oym4J35NANsqop2DhQ9Y3hJ27ZVZEbtnTvufX-oCEosZvY87LGgn1pP_q_4JJu_T7kw2kYIBMX_mQ8bLJXNJGXSZhype0o8T81XfgkbQEp3AvZ8xeOcvBUQUsB9o71_LSuq__0wTGwYVdAt3nHzn4ydYm4NOmECLFW_WW5SYamr8oYZMY" 
                />
                <div className="absolute bottom-2 left-2 bg-black px-2 py-1 font-mono text-xs text-white">FEATURED_SUBMISSION</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t-2 border-muted bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs text-muted-foreground">ACTIVE USERS</p>
            <p className="font-display text-2xl font-bold text-foreground">1,402</p>
          </div>
          <Button 
            variant="outline" 
            isMagnetic
            className="border-cyan-400/50 text-cyan-400 hover:bg-cyan-400 hover:text-black font-mono text-xs font-bold"
          >
            JOIN DISCORD
            <ExternalLink size={14} className="ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}

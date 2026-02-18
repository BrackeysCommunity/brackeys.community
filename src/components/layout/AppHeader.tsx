import { Clock01Icon, ComputerTerminal01Icon, Menu01Icon, Wifi01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useMagnetic } from '@/lib/hooks/use-cursor';

const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;

function MagneticLink({ children, className }: { children: React.ReactNode; className?: string }) {
  const { ref, position } = useMagnetic(0.2);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      data-cursor-corner-size="8"
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function AppHeader() {
  return (
    <header className="flex items-center justify-between border-b-2 border-primary bg-background/95 px-6 py-3 backdrop-blur-sm lg:px-10">
      {/* Logo */}
      <MagneticLink className="shrink-0">
        <Link to="/" className="flex items-center gap-2">
          <motion.div
            className="h-7 w-7"
            style={{
              maskImage: 'url(/brackeys-logo.svg)',
              maskSize: 'contain',
              maskRepeat: 'no-repeat',
              maskPosition: 'center',
              WebkitMaskImage: 'url(/brackeys-logo.svg)',
              WebkitMaskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
            }}
            initial={{
              backgroundImage: 'linear-gradient(to bottom, #FFC107, #E91E63, #9C27B0, #E91E63, #FFC107)',
              backgroundPosition: '0 0%',
              backgroundSize: '100% 500%',
            }}
            animate={{ backgroundPosition: ['0 0%', '0 0%', '0 100%', '0 100%', '0 0%'] }}
            transition={{ duration: 6, times: [0, 0.2, 0.4, 0.6, 0.8], repeat: Infinity, ease: 'linear' }}
          />
          <span className="font-bold text-foreground text-base leading-none">
            Brackeys
            <span className="bg-linear-to-r from-[#FFC107] via-[#E91E63] to-[#9C27B0] bg-clip-text text-transparent">
              Community
            </span>
          </span>
        </Link>
      </MagneticLink>

      {/* Nav Links */}
      <nav className="hidden md:flex items-center gap-6 font-mono text-sm font-bold tracking-widest">
        <MagneticLink>
          <Link to="/" className="px-2 py-1 text-foreground hover:text-primary transition-colors [&.active]:text-primary">
            HUB
          </Link>
        </MagneticLink>
        <MagneticLink>
          <a className="px-2 py-1 text-foreground hover:text-primary transition-colors" href="/collab">COLLAB</a>
        </MagneticLink>
        <MagneticLink>
          <a className="px-2 py-1 text-foreground hover:text-primary transition-colors" href="/profile">PROFILE</a>
        </MagneticLink>
      </nav>

      {/* Right side: status + actions */}
      <div className="hidden md:flex items-center gap-5">
        <div className="flex items-center gap-4 font-mono text-xs">
          <div className="flex items-center gap-1.5 text-cyan-400">
            <HugeiconsIcon icon={Wifi01Icon} size={14} />
            <span>CONNECTED</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <HugeiconsIcon icon={Clock01Icon} size={14} />
            <span>UTC 14:02</span>
          </div>
        </div>

        <Button
          variant="outline"
          size="icon-sm"
          isMagnetic
          className="border-muted hover:border-primary hover:text-primary shadow-[2px_2px_0px_var(--color-primary)]"
        >
          <HugeiconsIcon icon={ComputerTerminal01Icon} size={16} />
        </Button>

        <Button
          variant="default"
          isMagnetic
          className="font-mono text-xs font-bold tracking-widest px-5"
        >
          LOGIN_SYSTEM
        </Button>
      </div>

      {/* Mobile: hamburger only */}
      <div className="md:hidden text-foreground">
        <HugeiconsIcon icon={Menu01Icon} size={22} />
      </div>
    </header>
  );
}

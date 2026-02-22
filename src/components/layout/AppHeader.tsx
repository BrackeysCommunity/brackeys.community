import { Clock01Icon, ComputerTerminal01Icon, Menu01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link } from '@tanstack/react-router';
import { useInterval } from 'ahooks';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { UserMenu } from '@/components/layout/UserMenu';
import { authClient } from '@/lib/auth-client';
import { setAuthSession } from '@/lib/auth-store';
import { useCommandPalette } from '@/lib/hooks/use-command-palette';
import { useMagnetic } from '@/lib/hooks/use-cursor';

const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;
const isMac = navigator.platform.toLowerCase().includes('mac');

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

const getUtcTime = () => {
  const now = new Date();
  return `UTC ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
};

export function AppHeader() {
  const [utcTime, setUtcTime] = useState(getUtcTime);
  useInterval(() => setUtcTime(getUtcTime()), 1000);
  const { setOpen: openPalette } = useCommandPalette();
  const { data: session } = authClient.useSession();

  useEffect(() => {
    setAuthSession(session ?? null);
  }, [session]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-start justify-between px-6 pt-5 lg:px-10 pointer-events-none">
      {/* Logo */}
      <MagneticLink className="shrink-0 pointer-events-auto">
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
              backgroundImage: 'linear-gradient(to bottom, var(--color-brackeys-yellow), var(--color-brackeys-fuscia), var(--color-brackeys-purple), var(--color-brackeys-fuscia), var(--color-brackeys-yellow))',
              backgroundPosition: '0 0%',
              backgroundSize: '100% 500%',
            }}
            animate={{ backgroundPosition: ['0 0%', '0 0%', '0 100%', '0 100%', '0 0%'] }}
            transition={{ duration: 6, times: [0, 0.2, 0.4, 0.6, 0.8], repeat: Infinity, ease: 'linear' }}
          />
          <span className="font-mono font-bold text-foreground text-xl leading-wide">
            Brackeys
            <span className="bg-linear-to-r from-[var(--color-brackeys-yellow)] via-[var(--color-brackeys-fuscia)] to-[var(--color-brackeys-purple)] bg-clip-text text-transparent">
              Community
            </span>
          </span>
        </Link>
      </MagneticLink>

      {/* Right side: nav + status + actions */}
      <div className="hidden md:flex items-center gap-6 pointer-events-auto">
        <nav className="flex items-center gap-6 font-mono text-sm font-bold tracking-widest">
          <MagneticLink>
            <Link className="px-2 py-1 text-foreground hover:text-primary transition-colors" to="/command-center">COMMANDS</Link>
          </MagneticLink>
          <MagneticLink>
            <a className="px-2 py-1 text-foreground hover:text-primary transition-colors" href="/collab">COLLAB</a>
          </MagneticLink>
          <MagneticLink>
            <a className="px-2 py-1 text-foreground hover:text-primary transition-colors" href="/profile">PROFILE</a>
          </MagneticLink>
        </nav>

        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <HugeiconsIcon icon={Clock01Icon} size={14} />
          <span>{utcTime}</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          isMagnetic
          onClick={() => openPalette(true)}
          className="border-muted hover:border-primary hover:text-primary shadow-[2px_2px_0px_var(--color-primary)] font-mono text-xs gap-2 text-muted-foreground"
        >
          <HugeiconsIcon icon={ComputerTerminal01Icon} size={14} />
          <KbdGroup className="hidden lg:inline-flex opacity-60">
            <Kbd>{isMac ? '⌘' : 'CTRL'}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>

        {session?.user ? (
          <UserMenu user={session.user} />
        ) : (
          <Button
            variant="default"
            isMagnetic
            className="font-mono text-xs font-bold tracking-widest px-5"
            onClick={() => authClient.signIn.social({ provider: 'discord' })}
          >
            LOGIN
          </Button>
        )}
      </div>

      {/* Mobile: hamburger only */}
      <div className="md:hidden text-foreground pointer-events-auto">
        <HugeiconsIcon icon={Menu01Icon} size={22} />
      </div>
    </header>
  );
}

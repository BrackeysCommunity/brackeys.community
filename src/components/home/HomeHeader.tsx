import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Wifi, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

export function HomeHeader() {
  return (
    <header className="relative z-50 flex items-center justify-between border-b-2 border-primary bg-background/90 px-6 py-4 backdrop-blur-sm lg:px-12">
      <div className="flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2 group">
          <motion.div
            className="h-8 w-8"
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
              backgroundImage: "linear-gradient(to bottom, #FFC107, #E91E63, #9C27B0, #E91E63, #FFC107)",
              backgroundPosition: "0 0%",
              backgroundSize: "100% 500%"
            }}
            animate={{
              backgroundPosition: ["0 0%", "0 0%", "0 100%", "0 100%", "0 0%"]
            }}
            transition={{
              duration: 6,
              times: [0, .2, .4, .6, .8, 1],
              repeat: Infinity,
              ease: "linear"
            }}
          />
          <span className="font-bold text-foreground text-lg">
            Brackeys<span className="bg-gradient-to-r from-[#FFC107] via-[#E91E63] to-[#9C27B0] bg-clip-text text-transparent">Community</span>
          </span>
        </Link>
      </div>

      <div className="hidden items-center gap-8 md:flex">
        <div className="flex items-center gap-1 text-sm font-mono text-cyan-400">
          <Wifi size={16} />
          <span>CONNECTED</span>
        </div>
        <div className="flex items-center gap-1 text-sm font-mono text-muted-foreground">
          <Clock size={16} />
          <span>UTC 14:02</span>
        </div>
      </div>

      <Button 
        variant="default" 
        isMagnetic
        className="bg-primary hover:bg-foreground hover:text-background transition-all px-6 font-display font-bold"
      >
        LOGIN_SYSTEM
      </Button>
    </header>
  );
}

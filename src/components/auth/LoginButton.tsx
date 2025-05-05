import { motion } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../lib/utils';
import { DiscordLogo } from '../icons/DiscordLogo';

interface LoginButtonProps {
  className?: string;
}

export const LoginButton = ({ className }: LoginButtonProps) => {
  const { signInWithDiscord, state: { isLoading } } = useAuth();

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={signInWithDiscord}
      disabled={isLoading}
      className={cn(
        'flex items-center justify-center gap-2 px-6 py-3 text-white font-medium rounded-lg',
        'bg-[#5865F2] hover:bg-[#4752c4] transition-colors duration-200',
        'disabled:opacity-70 disabled:cursor-not-allowed',
        'focus:outline-hidden focus:ring-2 focus:ring-[#5865F2] focus:ring-opacity-50',
        'shadow-xs',
        className
      )}
    >
      {isLoading ? (
        <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
      ) : (
        <>
          <DiscordLogo className="w-5 h-5" />
          <span>Login with Discord</span>
        </>
      )}
    </motion.button>
  );
};
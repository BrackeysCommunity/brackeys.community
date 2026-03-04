import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ProfileAvatarProps {
  avatarUrl: string | null;
  username: string;
  tagline: string | null;
  size?: number;
  className?: string;
}

export function ProfileAvatar({
  avatarUrl,
  username,
  tagline,
  size = 96,
  className,
}: ProfileAvatarProps) {
  const initial = username.charAt(0).toUpperCase();

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <motion.div
        layoutId="profile-avatar"
        className="relative group"
      >
        <div className="absolute -inset-1 rounded-full bg-linear-to-br from-brackeys-yellow/40 via-transparent to-primary/30 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm" />
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={username}
            style={{ width: size, height: size }}
            className="relative rounded-full border-2 border-muted grayscale transition-all duration-500 group-hover:grayscale-0 group-hover:border-brackeys-yellow/60"
          />
        ) : (
          <div
            style={{ width: size, height: size }}
            className="relative flex items-center justify-center rounded-full border-2 border-muted bg-card/60 font-mono text-2xl font-bold text-muted-foreground transition-colors duration-300 group-hover:border-brackeys-yellow/60 group-hover:text-brackeys-yellow"
          >
            {initial}
          </div>
        )}
      </motion.div>

      <div className="text-center">
        <motion.p
          layoutId="profile-username"
          className="font-mono text-sm font-bold tracking-widest text-foreground"
        >
          {username}
        </motion.p>
        {tagline && (
          <motion.p
            layoutId="profile-tagline"
            className="font-mono text-xs text-muted-foreground/80 mt-1.5 max-w-[240px] leading-relaxed"
          >
            {tagline}
          </motion.p>
        )}
      </div>
    </div>
  );
}

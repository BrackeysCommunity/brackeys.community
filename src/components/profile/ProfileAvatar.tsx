import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

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
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <motion.div layoutId="profile-avatar" className="group relative">
        <div className="absolute -inset-1.5 rounded-full bg-linear-to-br from-brackeys-yellow/30 via-transparent to-primary/20 opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100" />
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={username}
            style={{ width: size, height: size }}
            className="relative rounded-full border-2 border-muted/80 grayscale transition-all duration-500 group-hover:border-brackeys-yellow/60 group-hover:grayscale-0"
          />
        ) : (
          <div
            style={{ width: size, height: size }}
            className="relative flex items-center justify-center rounded-full border-2 border-muted/80 bg-card/60 font-mono text-3xl font-bold text-muted-foreground/60 transition-colors duration-300 group-hover:border-brackeys-yellow/60 group-hover:text-brackeys-yellow"
          >
            {initial}
          </div>
        )}
      </motion.div>

      <div className="space-y-1 text-center">
        <motion.p
          layoutId="profile-username"
          className="font-mono text-base font-bold tracking-widest text-foreground"
        >
          {username}
        </motion.p>
        {tagline && (
          <motion.p
            layoutId="profile-tagline"
            className="max-w-[260px] font-sans text-xs leading-relaxed text-muted-foreground/70"
          >
            {tagline}
          </motion.p>
        )}
      </div>
    </div>
  );
}

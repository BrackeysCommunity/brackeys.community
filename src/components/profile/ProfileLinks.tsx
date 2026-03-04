import { Github01Icon, GlobalIcon, Share01Icon, TwitterIcon } from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { motion } from 'framer-motion';
import { buttonVariants } from '@/components/ui/button';
import { useMagnetic } from '@/lib/hooks/use-cursor';
import { cn } from '@/lib/utils';

const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;

interface SocialLinkDef {
  href: string;
  icon: IconSvgElement;
  label: string;
}

export function buildSocialLinks(profile: {
  githubUrl: string | null;
  twitterUrl: string | null;
  websiteUrl: string | null;
}): SocialLinkDef[] {
  const links: SocialLinkDef[] = [];
  if (profile.githubUrl) links.push({ href: profile.githubUrl, icon: Github01Icon, label: 'GitHub' });
  if (profile.twitterUrl) links.push({ href: profile.twitterUrl, icon: TwitterIcon, label: 'Twitter' });
  if (profile.websiteUrl) links.push({ href: profile.websiteUrl, icon: GlobalIcon, label: 'Website' });
  return links;
}

interface ProfileLinksProps {
  links: SocialLinkDef[];
  discordId: string | null;
  onShare: () => void;
  className?: string;
}

export function ProfileLinks({ links, discordId, onShare, className }: ProfileLinksProps) {
  return (
    <div className={cn('flex gap-2', className)}>
      {links.map((link) => (
        <MagneticIconLink key={link.label} href={link.href} icon={link.icon} label={link.label} />
      ))}

      {discordId && (
        <MagneticIconLink
          href={`https://discord.com/users/${discordId}`}
          icon={Share01Icon}
          label="Discord"
          accent="discord"
        />
      )}

      <MagneticIconButton onClick={onShare} icon={Share01Icon} label="Copy profile link" accent="yellow" />
    </div>
  );
}

function MagneticIconLink({
  href,
  icon,
  label,
  accent,
}: {
  href: string;
  icon: IconSvgElement;
  label: string;
  accent?: 'discord' | 'yellow';
}) {
  const { ref, position } = useMagnetic(0.3);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={label}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'h-8 w-8 p-0 flex items-center justify-center',
          accent === 'discord' && 'border-brackeys-purple/40 text-brackeys-purple hover:bg-brackeys-purple/10 hover:border-brackeys-purple',
          accent === 'yellow' && 'border-brackeys-yellow/40 text-brackeys-yellow hover:bg-brackeys-yellow/10 hover:border-brackeys-yellow',
          !accent && 'border-muted/60 text-muted-foreground hover:text-primary hover:border-primary/40',
        )}
      >
        <HugeiconsIcon icon={icon} size={14} />
      </a>
    </motion.div>
  );
}

function MagneticIconButton({
  onClick,
  icon,
  label,
  accent,
}: {
  onClick: () => void;
  icon: IconSvgElement;
  label: string;
  accent?: 'discord' | 'yellow';
}) {
  const { ref, position } = useMagnetic(0.3);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
    >
      <button
        type="button"
        onClick={onClick}
        title={label}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'h-8 w-8 p-0 flex items-center justify-center',
          accent === 'yellow' && 'border-brackeys-yellow/40 text-brackeys-yellow hover:bg-brackeys-yellow/10 hover:border-brackeys-yellow',
          !accent && 'border-muted/60 text-muted-foreground hover:text-primary hover:border-primary/40',
        )}
      >
        <HugeiconsIcon icon={icon} size={14} />
      </button>
    </motion.div>
  );
}

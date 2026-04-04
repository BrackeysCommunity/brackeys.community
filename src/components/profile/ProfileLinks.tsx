import {
  GameController01Icon,
  Github01Icon,
  GlobalIcon,
  Share01Icon,
  Tick01Icon,
  TwitterIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";
import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMagnetic } from "@/lib/hooks/use-cursor";
import { cn } from "@/lib/utils";

const springTransition = {
  type: "spring",
  stiffness: 1000,
  damping: 30,
  mass: 0.1,
} as const;

interface SocialLinkDef {
  href: string;
  icon: IconSvgElement;
  label: string;
  verified?: boolean;
}

interface LinkedAccountPreview {
  provider: string;
  providerProfileUrl: string | null;
}

export function buildSocialLinks(
  profile: {
    githubUrl: string | null;
    twitterUrl: string | null;
    websiteUrl: string | null;
  },
  linkedAccounts?: LinkedAccountPreview[],
): SocialLinkDef[] {
  const accountsByProvider = new Map(
    linkedAccounts?.map((account) => [account.provider, account]) ?? [],
  );

  const githubAccount = accountsByProvider.get("github");
  const twitterAccount = accountsByProvider.get("twitter");
  const itchIoAccount = accountsByProvider.get("itchio");
  const githubUrl = githubAccount?.providerProfileUrl ?? profile.githubUrl;
  const twitterUrl = twitterAccount?.providerProfileUrl ?? profile.twitterUrl;

  const links: SocialLinkDef[] = [];
  if (githubUrl)
    links.push({
      href: githubUrl,
      icon: Github01Icon,
      label: "GitHub",
      verified: Boolean(githubAccount),
    });
  if (twitterUrl)
    links.push({
      href: twitterUrl,
      icon: TwitterIcon,
      label: "Twitter",
      verified: Boolean(twitterAccount),
    });
  if (itchIoAccount?.providerProfileUrl)
    links.push({
      href: itchIoAccount.providerProfileUrl,
      icon: GameController01Icon,
      label: "itch.io",
      verified: true,
    });
  if (profile.websiteUrl)
    links.push({
      href: profile.websiteUrl,
      icon: GlobalIcon,
      label: "Website",
    });
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
    <div className={cn("flex gap-2", className)}>
      {links.map((link) => (
        <MagneticIconLink
          key={link.label}
          href={link.href}
          icon={link.icon}
          label={link.label}
          verified={link.verified}
        />
      ))}

      {discordId && (
        <MagneticIconLink
          href={`https://discord.com/users/${discordId}`}
          icon={Share01Icon}
          label="Discord"
          accent="discord"
        />
      )}

      <MagneticIconButton
        onClick={onShare}
        icon={Share01Icon}
        label="Copy profile link"
        accent="yellow"
      />
    </div>
  );
}

function MagneticIconLink({
  href,
  icon,
  label,
  verified,
  accent,
}: {
  href: string;
  icon: IconSvgElement;
  label: string;
  verified?: boolean;
  accent?: "discord" | "yellow";
}) {
  const { ref, position } = useMagnetic(0.3);
  const content = (
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
        aria-label={verified ? `${label} (verified via OAuth)` : label}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "relative h-8 w-8 p-0 flex items-center justify-center",
          accent === "discord" &&
            "border-brackeys-purple/40 text-brackeys-purple hover:bg-brackeys-purple/10 hover:border-brackeys-purple",
          accent === "yellow" &&
            "border-brackeys-yellow/40 text-brackeys-yellow hover:bg-brackeys-yellow/10 hover:border-brackeys-yellow",
          !accent &&
            "border-muted/60 text-muted-foreground hover:text-primary hover:border-primary/40",
        )}
      >
        <HugeiconsIcon icon={icon} size={14} />
        {verified && (
          <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-primary/60 bg-background text-primary">
            <HugeiconsIcon icon={Tick01Icon} size={8} />
          </span>
        )}
      </a>
    </motion.div>
  );

  if (!verified) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={content} />
      <TooltipContent>Verified via OAuth</TooltipContent>
    </Tooltip>
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
  accent?: "discord" | "yellow";
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
          buttonVariants({ variant: "outline", size: "sm" }),
          "h-8 w-8 p-0 flex items-center justify-center",
          accent === "yellow" &&
            "border-brackeys-yellow/40 text-brackeys-yellow hover:bg-brackeys-yellow/10 hover:border-brackeys-yellow",
          !accent &&
            "border-muted/60 text-muted-foreground hover:text-primary hover:border-primary/40",
        )}
      >
        <HugeiconsIcon icon={icon} size={14} />
      </button>
    </motion.div>
  );
}

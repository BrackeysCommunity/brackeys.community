import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect } from "react";

import type { Announcement } from "@/components/announcements/announcements";
import {
  hideSpotlight,
  showSpotlight,
  SPOTLIGHT_KEEP_ATTR,
} from "@/components/announcements/spotlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

export interface FeatureBannerProps {
  announcement: Announcement;
  onDismiss: () => void;
  onFollow: () => void;
  className?: string;
}

export function FeatureBanner({
  announcement,
  onDismiss,
  onFollow,
  className,
}: FeatureBannerProps) {
  const { eyebrow, title, body, cta } = announcement;
  const target = cta.spotlight;
  const lit = target ? () => showSpotlight(target) : undefined;
  const unlit = target ? () => hideSpotlight(target) : undefined;

  // The CTA unmounts mid-hover when it's followed or the banner is dismissed,
  // and no leave event fires for an element that's gone.
  useEffect(() => (target ? () => hideSpotlight(target) : undefined), [target]);

  return (
    <motion.aside
      aria-label={title}
      {...{ [SPOTLIGHT_KEEP_ATTR]: "" }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "pointer-events-auto relative flex w-full max-w-sm flex-col gap-3 rounded-lg border border-border bg-card p-4 pr-10 shadow-lg",
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        tooltip="Dismiss"
        className="absolute top-2 right-2"
        onClick={onDismiss}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} />
      </Button>
      <div className="flex flex-col gap-1">
        {eyebrow ? (
          <Badge size="label" className="self-start">
            {eyebrow}
          </Badge>
        ) : null}
        <Heading as="h2" size="md" display>
          {title}
        </Heading>
        <Text variant="muted">{body}</Text>
      </div>
      <Button
        size="sm"
        className="self-start"
        render={<Link {...cta.link} />}
        onPointerEnter={lit}
        onPointerLeave={unlit}
        onFocus={lit}
        onBlur={unlit}
        onClick={onFollow}
      >
        {cta.label}
      </Button>
    </motion.aside>
  );
}

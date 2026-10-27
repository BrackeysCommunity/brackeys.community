import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

import type { Announcement } from "@/components/announcements/announcements";
import { BannerCard } from "@/components/announcements/BannerCard";
import { hideSpotlight, showSpotlight } from "@/components/announcements/spotlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";

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
    <BannerCard label={title} onDismiss={onDismiss} className={className}>
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
    </BannerCard>
  );
}

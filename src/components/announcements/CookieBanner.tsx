import { Link } from "@tanstack/react-router";

import { BannerCard } from "@/components/announcements/BannerCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";
import { useAnalyticsPreference } from "@/lib/hooks/use-analytics-preference";
import { setAnalyticsEnabled } from "@/lib/product-insights";
import { cn } from "@/lib/utils";

const TITLE = "No tracking cookies";

export interface CookieBannerProps {
  onDismiss: () => void;
  onFollow: () => void;
  className?: string;
}

/**
 * Says what the site stores and sends instead of asking to store more. The
 * one choice it offers is the analytics opt-out Settings → Privacy has, and
 * it applies the moment it's clicked.
 */
export function CookieBanner({ onDismiss, onFollow, className }: CookieBannerProps) {
  const preference = useAnalyticsPreference();
  const enabled = preference === "on";

  return (
    <BannerCard label={TITLE} art="cookie" onDismiss={onDismiss} className={className}>
      <div className="flex flex-col gap-1 pr-24">
        <Badge size="label" className="self-start">
          COOKIES
        </Badge>
        <Heading as="h2" size="md" display>
          {TITLE}
        </Heading>
      </div>
      <Text variant="muted">
        The only cookie here keeps you signed in. Your theme, sound, and dismissed notices stay in
        this browser, and nothing follows you around the web.
      </Text>
      <Text size="xs" variant="muted" className="flex flex-wrap items-center gap-x-1.5">
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", enabled ? "bg-primary" : "bg-muted-foreground")}
        />
        {enabled
          ? "Anonymous, cookieless analytics is on."
          : preference === "off-gpc"
            ? "Analytics is off: your browser sends Global Privacy Control."
            : "Analytics is off. Nothing leaves this browser."}
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0"
          onClick={() => setAnalyticsEnabled(!enabled)}
        >
          {enabled ? "Turn off" : "Turn on"}
        </Button>
      </Text>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onDismiss}>
          Got it
        </Button>
        <Button
          size="sm"
          variant="outline"
          render={<Link to="/privacy" hash="cookies-analytics" />}
          onClick={onFollow}
        >
          Privacy policy
        </Button>
      </div>
    </BannerCard>
  );
}

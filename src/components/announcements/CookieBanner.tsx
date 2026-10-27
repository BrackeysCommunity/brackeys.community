import { Link } from "@tanstack/react-router";

import { BannerCard } from "@/components/announcements/BannerCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Heading, Text } from "@/components/ui/typography";
import { useAnalyticsPreference } from "@/lib/hooks/use-analytics-preference";
import { setAnalyticsEnabled } from "@/lib/product-insights";

const TITLE = "No tracking cookies";

export interface CookieBannerProps {
  onDismiss: () => void;
  onFollow: () => void;
  className?: string;
}

/**
 * Says what the site stores and sends instead of asking to store more. The
 * only consent-shaped control is the analytics switch, the same one Settings
 * → Privacy has, and it applies the moment it's flipped.
 */
export function CookieBanner({ onDismiss, onFollow, className }: CookieBannerProps) {
  const preference = useAnalyticsPreference();
  const enabled = preference === "on";

  return (
    <BannerCard label={TITLE} onDismiss={onDismiss} className={className}>
      <div className="flex flex-col gap-1">
        <Badge size="label" className="self-start">
          COOKIES
        </Badge>
        <Heading as="h2" size="md" display>
          {TITLE}
        </Heading>
        <Text variant="muted">
          The only cookies here keep you signed in. Your theme, sound, and dismissed notices stay in
          this browser, and nothing is used to follow you around the web.
        </Text>
      </div>
      <div className="flex items-center gap-3 rounded-md border border-border p-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Text size="xs">Anonymous analytics</Text>
          <Text size="xs" variant="muted">
            {enabled
              ? "Cookieless, EU-hosted, and how we learn what to build next."
              : preference === "off-gpc"
                ? "Off, because your browser sends Global Privacy Control."
                : "Off. Nothing leaves this browser."}
          </Text>
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={(next) => setAnalyticsEnabled(next)}
          aria-label="Send anonymous usage analytics"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onDismiss}>
          Got it
        </Button>
        <Button
          size="sm"
          variant="ghost"
          render={<Link to="/privacy" hash="cookies-analytics" />}
          onClick={onFollow}
        >
          Privacy policy
        </Button>
      </div>
    </BannerCard>
  );
}

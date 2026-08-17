import { ArrowRight01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { GraphPaper } from "@/components/ui/graph-paper";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

export interface NotificationsHeroProps {
  unread: number;
  total: number;
  /** Hidden while the counts are still pending — a "mark all read" that
   *  can't know whether anything is unread is a button that does nothing. */
  onMarkAllRead: () => void;
  markAllReadPending: boolean;
}

/**
 * The inbox masthead, cut from the same block as the admin and directory
 * heroes — notched well, gradient wash, graph ruling behind the headline.
 * The two counts sit in it for the same reason the admin queue sizes do:
 * "how much is waiting" is the question the reader arrives with, and it
 * should be answered before the tabs are read.
 */
export function NotificationsHero({
  unread,
  total,
  onMarkAllRead,
  markAllReadPending,
}: NotificationsHeroProps) {
  return (
    <Well
      notchOpts
      // The gradient belongs to the surface alone — the notched corners fall
      // outside its clip path and `Well` fills them with the frame's lighter
      // face, so carrying the wash out there reads as a second panel behind.
      surfaceClassName="bg-card bg-linear-to-br from-deboss-surface via-deboss-surface to-primary/12 backdrop-blur-none"
    >
      <GraphPaper fade="bottom-left" />
      <div className="relative flex flex-wrap items-end justify-between gap-6 p-6">
        <div className="flex max-w-prose min-w-64 flex-col gap-2">
          <MicroLabel>INBOX</MicroLabel>
          <Heading as="h1" className="text-2xl tracking-widest uppercase">
            {unread > 0 ? "Someone needs you" : "You're all caught up"}
          </Heading>
          <Text size="sm" variant="muted">
            Responses to your posts, team invites, jam deadlines, and staff decisions — everything
            the site did on your behalf while you were away.
          </Text>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={onMarkAllRead}
              disabled={unread === 0 || markAllReadPending}
            >
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              Mark all read
            </Button>
            <Button
              variant="ghost"
              size="xs"
              nativeButton={false}
              render={<Link to="/settings/notifications" />}
            >
              Preferences
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} data-icon="inline-end" />
            </Button>
          </div>
        </div>

        <dl className="flex flex-wrap items-end gap-6">
          {[
            { label: "Unread", value: unread },
            { label: "All time", value: total },
          ].map((stat) => (
            // dt before dd in the DOM, reversed for display: the number
            // reads first, the label under it, without lying to a reader.
            <div key={stat.label} className="flex flex-col-reverse gap-0.5">
              <dt>
                <MicroLabel as="span">{stat.label.toUpperCase()}</MicroLabel>
              </dt>
              <dd
                className={cn(
                  "text-3xl leading-none font-bold tracking-tighter tabular-nums",
                  stat.value > 0 ? "text-foreground" : "text-foreground/30",
                )}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Well>
  );
}

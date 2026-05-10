import { Cancel01Icon, Login01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";
import { authClient } from "@/lib/auth-client";

interface CollabCreateUnauthProps {
  isTouch: boolean;
  onClose: () => void;
}

/**
 * Body shown when the flyout opens without an authenticated user — a
 * "// ACCESS DENIED" callout plus a Discord sign-in button.
 */
export function CollabCreateUnauth({ isTouch, onClose }: CollabCreateUnauthProps) {
  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-muted/30 px-5 pt-5 pb-4">
        {isTouch ? (
          <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/30" />
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <Heading as="h2" monospace className="text-lg tracking-widest uppercase">
              POST A GIG.
            </Heading>
            <Text monospace size="xs" variant="muted" className="tracking-widest">
              AUTH REQUIRED
            </Text>
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Close"
            onClick={onClose}
            className="font-mono"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </Button>
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <Heading as="h3" monospace className="text-sm tracking-[0.2em] text-destructive uppercase">
          // ACCESS DENIED
        </Heading>
        <Text monospace size="xs" variant="muted" className="max-w-[260px]">
          Authenticate with Discord to post a gig, hobby project, playtest, or mentorship.
        </Text>
        <Button
          variant="outline"
          size="sm"
          onClick={() => authClient.signIn.social({ provider: "discord" })}
          className="gap-2 border-primary/60 font-mono tracking-widest text-primary hover:border-primary hover:bg-primary/10"
        >
          <HugeiconsIcon icon={Login01Icon} size={13} />
          Sign In with Discord
        </Button>
      </div>
    </>
  );
}

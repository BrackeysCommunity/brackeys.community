import { Login01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";
import { signInWithDiscord } from "@/lib/auth-client";

/**
 * Body shown when the flyout opens without an authenticated user — a
 * "ACCESS DENIED" callout plus a Discord sign-in button. Carries no
 * close control; the drawer owns dismissal.
 */
export function CollabCreateUnauth() {
  return (
    <>
      <div className="flex shrink-0 flex-col gap-0.5 border-b border-muted/30 px-5 pt-4 pb-4">
        <Heading as="h2" className="text-lg tracking-widest uppercase">
          POST A GIG.
        </Heading>
        <Text size="xs" variant="muted" className="tracking-widest">
          AUTH REQUIRED
        </Text>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <Heading as="h3" className="text-sm tracking-[0.2em] text-destructive uppercase">
          ACCESS DENIED
        </Heading>
        <Text size="xs" variant="muted" className="max-w-[260px]">
          Authenticate with Discord to post a gig, hobby project, playtest, or mentorship.
        </Text>
        <Button
          variant="outline"
          size="sm"
          onClick={() => signInWithDiscord()}
          className="gap-2 border-primary/60 tracking-widest text-primary hover:border-primary hover:bg-primary/10"
        >
          <HugeiconsIcon icon={Login01Icon} size={13} />
          Sign In with Discord
        </Button>
      </div>
    </>
  );
}

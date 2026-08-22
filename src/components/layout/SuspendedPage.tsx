import { Logout03Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";

import { CONTACT, SITE } from "@/components/legal/legal-meta";
import { Button } from "@/components/ui/button";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { EVENTS } from "@/lib/analytics-events";
import { authClient } from "@/lib/auth-client";
import { timeAgo } from "@/lib/format-time";
import { formatCountdown } from "@/lib/jam-countdown";
import { captureEvent, resetIdentity } from "@/lib/posthog";

/** What a suspended account is shown; the reason is the staff note from the ban. */
export function SuspendedPage({
  bannedAt,
  until,
  reason,
}: {
  bannedAt: Date | string | null;
  until: Date | string | null;
  reason: string | null;
}) {
  const navigate = useNavigate();
  const remaining = formatCountdown(until);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-3">
        <MicroLabel as="p" variant="danger" className="uppercase">
          § ACCOUNT SUSPENDED
        </MicroLabel>
        <Heading as="h1" size="3xl" display>
          Your account is suspended
        </Heading>
        <Text as="p" variant="muted" textWrap="pretty">
          You can still read the parts of {SITE.name} that are open to everyone, but you can&apos;t
          post, comment, or take part while the suspension is in force.
        </Text>
      </div>

      <Well className="gap-4 p-5">
        <div className="flex flex-col gap-1">
          <MicroLabel>SUSPENDED</MicroLabel>
          <Text size="sm">{bannedAt ? timeAgo(bannedAt) : "—"}</Text>
        </div>

        <div className="flex flex-col gap-1">
          <MicroLabel>REASON</MicroLabel>
          <Text size="sm" textWrap="pretty">
            {reason ?? "No reason was recorded. Write to us and we'll explain."}
          </Text>
        </div>

        <div className="flex flex-col gap-1">
          <MicroLabel>ENDS</MicroLabel>
          <Text size="sm">
            {until == null
              ? "It doesn't — this suspension has no end date."
              : remaining?.past
                ? "It has already ended. Sign out and back in to pick up where you left off."
                : `In ${remaining?.text ?? "—"}, without anyone having to act.`}
          </Text>
        </div>
      </Well>

      <Well variant="ghost" className="gap-3 p-5">
        <Text as="p" size="sm" textWrap="pretty">
          If you think this is wrong, or you want to appeal it, write to a human — include the
          account this is about and anything you want the staff to weigh.
        </Text>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            nativeButton={false}
            render={<a href={`mailto:${CONTACT.abuse}`} aria-label={`Email ${CONTACT.abuse}`} />}
          >
            <HugeiconsIcon icon={Mail01Icon} size={13} />
            {CONTACT.abuse}
          </Button>
          <Button
            variant="ghost"
            className="gap-2"
            onClick={async () => {
              await authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    captureEvent(EVENTS.authSignedOut, { source: "suspended_page" });
                    resetIdentity();
                    navigate({ to: "/", reloadDocument: true });
                  },
                },
              });
            }}
          >
            <HugeiconsIcon icon={Logout03Icon} size={13} />
            Sign out
          </Button>
        </div>
      </Well>
    </div>
  );
}

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { NotificationPreferences } from "@/components/notifications/NotificationPreferences";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

import { SettingsSection, SignedOutNotice } from "./SettingsUI";

/**
 * The per-event notification matrix, which used to be a tab on
 * `/notifications`. That route keeps the inbox; its old
 * `?view=preferences` link redirects here so there's one place to
 * change a setting.
 */
export function NotificationsSection() {
  const { data: session } = authClient.useSession();

  return (
    <SettingsSection
      index="01"
      title="Notifications"
      action={
        session?.user ? (
          <Button
            variant="outline"
            size="xs"
            className="tracking-widest"
            render={<Link to="/notifications" search={{ view: "inbox", filter: "all" }} />}
          >
            INBOX
            <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} />
          </Button>
        ) : null
      }
    >
      {session?.user ? (
        <NotificationPreferences />
      ) : (
        <SignedOutNotice>
          Notification preferences live on your account — sign in to choose what reaches your inbox
          and your email.
        </SignedOutNotice>
      )}
    </SettingsSection>
  );
}

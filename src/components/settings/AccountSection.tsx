import {
  Delete02Icon,
  Logout03Icon,
  Share01Icon,
  Shield02Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { openConfirmModal } from "@/components/ui/confirm";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { activeUserStore } from "@/lib/active-user-store";
import { authClient } from "@/lib/auth-client";
import { profileLinkParams } from "@/lib/profile-links";

import { ActiveSessions } from "./ActiveSessions";
import { ConnectedAccounts } from "./ConnectedAccounts";
import { SettingsSection, SignedOutNotice } from "./SettingsUI";

/**
 * Who you're signed in as, what can sign you in, where you're signed in,
 * and how to leave. Everything editable about the *profile* still lives on
 * the profile — this only points at it.
 */
export function AccountSection() {
  const { data: session } = authClient.useSession();
  const activeProfile = useStore(activeUserStore, (s) => s.profile);
  const navigate = useNavigate();
  const user = session?.user;

  if (!user) {
    return (
      <SettingsSection index="01" title="Account">
        <SignedOutNotice>
          You're browsing signed out. Theme and motion are saved in this browser; everything else
          needs an account.
        </SignedOutNotice>
      </SettingsSection>
    );
  }

  const profileParams = profileLinkParams({ id: user.id, urlStub: activeProfile?.urlStub });

  return (
    <>
      <SettingsSection index="01" title="Identity">
        <Well className="flex-row flex-wrap items-center gap-4 p-4">
          <UserAvatar avatarUrl={user.image} username={user.name} size={48} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <Text size="sm" className="truncate font-bold">
                {user.name ?? "User"}
              </Text>
              {activeProfile?.isStaff ? (
                <Badge size="label" variant="outline">
                  STAFF
                </Badge>
              ) : null}
            </div>
            <Text size="xs" variant="muted" className="truncate">
              {user.email ?? "Signed in with Discord"}
            </Text>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="tracking-widest"
              render={<Link to="/profile" />}
            >
              <HugeiconsIcon icon={UserIcon} size={14} />
              EDIT PROFILE
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="tracking-widest"
              render={<Link to="/profile/$userId" params={profileParams} />}
            >
              <HugeiconsIcon icon={Share01Icon} size={14} />
              VIEW PUBLIC
            </Button>
          </div>
        </Well>

        {/* Staff-only, and only ever a shortcut — the route loader and every
            procedure behind it re-check server-side. */}
        {activeProfile?.isStaff ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start tracking-widest"
            render={<Link to="/admin" search={{ section: "reports" }} />}
          >
            <HugeiconsIcon icon={Shield02Icon} size={14} />
            ADMIN
          </Button>
        ) : null}
      </SettingsSection>

      <SettingsSection
        index="02"
        title="Sign-in connections"
        hint="The providers that can get you into this account. Provider tokens for project and jam sync are separate — those live on your profile."
      >
        <ConnectedAccounts />
      </SettingsSection>

      <SettingsSection
        index="03"
        title="Devices"
        hint="Every browser holding a live session. Don't recognise one? Sign it out."
      >
        <ActiveSessions />
      </SettingsSection>

      <SettingsSection
        index="04"
        title="Session"
        hint="Signing out ends this browser's session. Your theme and motion choices stay behind."
      >
        <Button
          variant="outline"
          size="sm"
          className="self-start tracking-widest text-destructive"
          onClick={async () => {
            await authClient.signOut({
              fetchOptions: {
                onSuccess: () => navigate({ to: "/", reloadDocument: true }),
              },
            });
          }}
        >
          <HugeiconsIcon icon={Logout03Icon} size={14} />
          SIGN OUT
        </Button>
      </SettingsSection>

      <DangerZone />
    </>
  );
}

/**
 * Deletion is two-step by construction: this only *requests* it, and the
 * emailed link is what actually runs it. That's the server's design (these
 * accounts have no password to re-enter), so the copy has to set the
 * expectation that nothing happens until the mail is opened.
 */
function DangerZone() {
  const { mutate: requestDeletion, isPending } = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.deleteUser({ callbackURL: "/" });
      if (error) throw new Error(error.message ?? "Could not start the deletion");
    },
    onSuccess: () =>
      toast.success("Check your email", {
        description: "Nothing is deleted until you open the confirmation link.",
      }),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <SettingsSection
      index="05"
      title="Delete account"
      hint="Removes your profile, projects, posts, comments, and notification history. Jams you took part in keep their entry records. This cannot be undone."
    >
      <Button
        variant="destructive"
        size="sm"
        className="self-start tracking-widest"
        disabled={isPending}
        onClick={async () => {
          const ok = await openConfirmModal({
            title: "Delete your account?",
            message:
              "We'll email you a confirmation link. Your account stays exactly as it is until you open it — after that, everything above goes for good.",
            confirmText: "Email me the link",
            variant: "destructive",
          });
          if (ok) requestDeletion();
        }}
      >
        <HugeiconsIcon icon={Delete02Icon} size={14} />
        DELETE ACCOUNT
      </Button>
    </SettingsSection>
  );
}

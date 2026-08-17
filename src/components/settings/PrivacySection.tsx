import { NoteIcon, UserBlock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { authClient } from "@/lib/auth-client";
import { timeAgo } from "@/lib/format-time";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

import { SettingRow, SettingsSection, SignedOutNotice } from "./SettingsUI";

/**
 * Who can reach you. Both controls existed already but only where they were
 * used — the wall toggle on your own profile, the block list buried under
 * the notification matrix. Neither is discoverable from the thing it
 * governs once you've walked away from it, so they collect here.
 */
export function PrivacySection() {
  const { data: session } = authClient.useSession();

  if (!session?.user) {
    return (
      <SettingsSection index="01" title="Privacy">
        <SignedOutNotice>
          Privacy settings are attached to an account — sign in to choose who can reach you.
        </SignedOutNotice>
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        index="01"
        title="Profile wall"
        hint="The note wall on your public profile. Turning it off hides existing notes from visitors — it never deletes them, and turning it back on brings them straight back."
      >
        <WallNotesToggle />
      </SettingsSection>

      <SettingsSection
        index="02"
        title="Blocked members"
        hint="Their comments are hidden from you, yours from them, and notifications stop travelling in either direction."
      >
        <BlockedMembers />
      </SettingsSection>
    </>
  );
}

function WallNotesToggle() {
  const queryClient = useQueryClient();
  const profileQuery = orpc.getMyProfile.queryOptions({ input: {} });
  const { data, isLoading } = useQuery(profileQuery);

  const { mutate: toggle, isPending } = useMutation({
    mutationFn: (next: boolean) => client.updateProfile({ profileNotesEnabled: next }),
    onSuccess: (_result, next) => {
      void queryClient.invalidateQueries({ queryKey: profileQuery.queryKey });
      toast.success(next ? "Wall notes turned on" : "Wall notes turned off");
    },
    onError: () => toast.error("Failed to update the wall setting"),
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;

  const enabled = data?.profile.profileNotesEnabled ?? true;

  return (
    <SettingRow
      label="Allow notes"
      hint={
        enabled
          ? "Anyone signed in can leave a note on your profile."
          : "Only you can see the wall, and no one can post to it."
      }
      icon={NoteIcon}
      control={
        <Switch
          checked={enabled}
          disabled={isPending || !data}
          onCheckedChange={(next) => toggle(next)}
          aria-label="Allow notes on my profile"
        />
      }
    />
  );
}

function BlockedMembers() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["listBlockedUsers"],
    queryFn: () => client.listBlockedUsers({}),
  });

  const { mutate: unblock, isPending } = useMutation({
    mutationFn: (userId: string) => client.unblockUser({ userId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["listBlockedUsers"] });
      void queryClient.invalidateQueries({ queryKey: ["listComments"] });
      toast.success("Unblocked");
    },
    onError: () => toast.error("Failed to unblock"),
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;

  if (!data || data.length === 0) {
    return (
      <Well className="items-center gap-2 p-8" variant="ghost">
        <HugeiconsIcon icon={UserBlock01Icon} size={20} className="text-muted-foreground" />
        <Text size="xs" variant="muted" align="center">
          You haven't blocked anyone. Blocking is on the ··· menu of any comment or profile.
        </Text>
      </Well>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {data.map((row) => (
        <Well key={row.userId} className="flex-row items-center gap-3 p-3">
          <UserAvatar avatarUrl={row.user?.avatarUrl ?? null} username={row.user?.name} size={28} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Text size="xs" className="truncate">
              {row.user?.name ?? "Deleted User"}
            </Text>
            <Text size="xs" variant="muted">
              Blocked {timeAgo(row.blockedAt)}
            </Text>
          </div>
          <Button
            variant="outline"
            size="xs"
            onClick={() => unblock(row.userId)}
            disabled={isPending}
            className="tracking-widest"
          >
            UNBLOCK
          </Button>
        </Well>
      ))}
    </div>
  );
}

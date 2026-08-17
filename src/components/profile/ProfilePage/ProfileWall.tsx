import { useMutation, useQueryClient } from "@tanstack/react-query";

import { CommentThread } from "@/components/comments/CommentThread";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

import { ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileWallSectionProps {
  index: string;
  profileId: string;
  /** Display name for the composer placeholder ("Leave a note on X's wall…"). */
  profileName: string;
  isOwner: boolean;
  notesEnabled: boolean;
  /** `getProfile` query key — invalidated when the owner flips the toggle. */
  queryKey?: readonly unknown[];
}

/**
 * `§NN PROFILE WALL` — public notes other members leave on a profile,
 * backed by the shared comment-thread system (`subject: profile`). The
 * owner can reply, remove any note, and turn the wall off entirely;
 * turning it off hides the section from visitors without deleting
 * anything.
 */
export function ProfileWallSection({
  index,
  profileId,
  profileName,
  isOwner,
  notesEnabled,
  queryKey,
}: ProfileWallSectionProps) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (next: boolean) => client.updateProfile({ profileNotesEnabled: next }),
    onSuccess: (_data, next) => {
      if (queryKey) void qc.invalidateQueries({ queryKey });
      toast.success(next ? "Wall notes turned on" : "Wall notes turned off");
    },
    onError: () => toast.error("Failed to update the wall setting"),
  });

  // Visitors never see a disabled wall — not even an empty shell.
  if (!notesEnabled && !isOwner) return null;

  const ownerToggle = isOwner ? (
    <div className="flex items-center gap-2">
      <Text as="span" size="xs" variant="muted" className="tracking-widest uppercase">
        Allow notes
      </Text>
      <Switch
        checked={notesEnabled}
        onCheckedChange={(next) => toggle.mutate(next)}
        disabled={toggle.isPending}
        aria-label="Allow notes on my profile"
      />
    </div>
  ) : undefined;

  return (
    <CommentThread
      subject={{ type: "profile", id: profileId }}
      maxLength={500}
      placeholder={
        isOwner ? "Reply to a note, or pin a thought…" : `Leave a note on ${profileName}'s wall…`
      }
      emptyLabel="NO WALL NOTES YET"
      emptyHint={
        isOwner
          ? "Notes from other members land here."
          : `Be the first to leave ${profileName} a note.`
      }
      shell={(content, count) => (
        <section className="flex flex-col gap-3">
          <ProfileSectionHeader
            index={index}
            title={
              count > 0
                ? `PROFILE WALL · ${count} ${count === 1 ? "NOTE" : "NOTES"}`
                : "PROFILE WALL"
            }
            action={ownerToggle}
          />
          {isOwner && !notesEnabled ? (
            <Well variant="ghost" className="items-center gap-1 p-4 backdrop-blur-none">
              <Text size="xs" variant="muted" className="tracking-widest uppercase">
                Wall notes are off — visitors can't see or leave notes.
              </Text>
            </Well>
          ) : null}
          {notesEnabled || isOwner ? content : null}
        </section>
      )}
    />
  );
}

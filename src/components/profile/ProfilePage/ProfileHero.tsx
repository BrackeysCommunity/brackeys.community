import { DiscordIcon, Edit02Icon, Share05Icon, UserBlock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Switch } from "@/components/ui/switch";
import { Heading, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { authStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";

import { GradientBanner } from "./GradientBanner";
import { formatCommitment, type ProfileAvailability, type ProfileViewModel } from "./helpers";

interface ProfileHeroProps {
  profile: ProfileViewModel;
  isOwner: boolean;
  onEditProfile: () => void;
  /** Query key for the underlying `getProfile` fetch — the owner's
   * availability toggle mutates `availableForWork` directly and
   * invalidates this so the pill/badges/directory state stay honest. */
  queryKey?: readonly unknown[];
  /** Mobile compact mode — banner shortens and the identity block
   * stacks under the avatar instead of flowing beside it. */
  compact?: boolean;
}

/**
 * Top-of-page hero card. A striped pastel gradient strip (seeded by
 * the user's handle so every profile keeps a stable colorway) with
 * the avatar tile overlapping its lower edge, then the identity row:
 * name + availability pill, and a mono meta line (@handle · top
 * skills · location · timezone · member since).
 *
 * Owners get a real AVAILABLE FOR WORK toggle card pinned to the
 * hero's right side; visitors see the pill only and hire details in
 * the sidebar.
 */
export function ProfileHero({
  profile,
  isOwner,
  onEditProfile,
  queryKey,
  compact = false,
}: ProfileHeroProps) {
  return (
    <Well className="overflow-hidden p-0">
      <GradientBanner
        seed={profile.handle}
        pattern="vertical"
        className={compact ? "h-16 w-full" : "h-28 w-full"}
      />

      <div className={cn("relative flex flex-col gap-3 px-4 pb-4", !compact && "sm:px-5 sm:pb-5")}>
        {/* Avatar row — the actions cluster sits to its right, level
            with the banner edge, so the identity stack below keeps a
            single uninterrupted left edge. */}
        <div className="flex items-start justify-between gap-4">
          <AvatarTile profile={profile} compact={compact} />
          {compact ? null : (
            <div className="flex flex-row flex-wrap items-center justify-end gap-2 pt-3">
              {isOwner ? (
                <AvailabilityToggleCard
                  availability={profile.availability}
                  queryKey={queryKey}
                  compact={compact}
                />
              ) : null}
              <ActionRow
                isOwner={isOwner}
                onEditProfile={onEditProfile}
                profile={profile}
                compact={compact}
              />
            </div>
          )}
        </div>

        {/* Identity stack — name, tagline, meta, one-liner all share
            one left edge under the avatar. */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Heading
              as="h1"
              className={cn(
                "leading-none tracking-tight text-foreground",
                compact ? "text-3xl" : "text-4xl",
              )}
            >
              {profile.name}
            </Heading>
            <AvailabilityPill availability={profile.availability} />
          </div>
          {profile.tag ? (
            <span className="text-lg leading-tight font-semibold tracking-tight text-accent">
              {profile.tag}
            </span>
          ) : null}
          <MetaLine profile={profile} />
          {profile.oneLiner ? (
            <Text size="sm" variant="muted" className="max-w-prose tracking-wide">
              {profile.oneLiner}
            </Text>
          ) : null}
        </div>

        {compact ? (
          <div className="flex flex-row flex-wrap items-stretch gap-2">
            {isOwner ? (
              <AvailabilityToggleCard
                availability={profile.availability}
                queryKey={queryKey}
                compact={compact}
              />
            ) : null}
            <ActionRow
              isOwner={isOwner}
              onEditProfile={onEditProfile}
              profile={profile}
              compact={compact}
            />
          </div>
        ) : null}
      </div>
    </Well>
  );
}

function AvatarTile({ profile, compact }: { profile: ProfileViewModel; compact: boolean }) {
  return (
    <div
      className={cn(
        "relative z-10 shrink-0 overflow-hidden rounded border-4 border-card bg-card",
        compact ? "-mt-10 h-20 w-20" : "-mt-12 h-28 w-28",
      )}
    >
      {profile.avatar.imageUrl ? (
        <img
          src={profile.avatar.imageUrl}
          alt={profile.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <GradientBanner seed={profile.handle} className="flex h-full w-full">
          <span
            aria-hidden
            className={cn(
              "relative m-auto font-mono leading-none font-bold tracking-tight text-white/90",
              compact ? "text-4xl" : "text-5xl",
            )}
          >
            {profile.avatar.glyph}
          </span>
        </GradientBanner>
      )}
    </div>
  );
}

function AvailabilityPill({ availability }: { availability: ProfileAvailability }) {
  if (availability.state === "closed") return null;
  const open = availability.state === "open";
  return (
    <Badge variant={open ? "success" : "warning"} size="label" className="gap-1.5 uppercase">
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {open ? "Available for work" : "Selectively open"}
    </Badge>
  );
}

/** The `@handle · skill · skill · location · UTC+1 · member since`
 * mono line under the name — mirrors the reference layout's single
 * dotted meta row rather than a chip pile. */
function MetaLine({ profile }: { profile: ProfileViewModel }) {
  const topSkills = profile.skills
    .filter((s) => s.state === "active")
    .slice(0, 2)
    .map((s) => s.name);
  const joinedYear = profile.joinedAt.getUTCFullYear();
  const parts: string[] = [
    `@${profile.handle}`,
    ...topSkills,
    ...(profile.pronouns ? [profile.pronouns] : []),
    ...(profile.location ? [profile.location] : []),
    ...(profile.availability.timezone ? [profile.availability.timezone] : []),
    `Member since ${joinedYear}`,
  ];
  return (
    <Text size="xs" variant="muted" className="tracking-widest">
      {parts.join("  ·  ")}
    </Text>
  );
}

/** Owner-only card with a live switch bound to
 * `developer_profiles.availableForWork` — flipping it updates the
 * directory listing immediately. */
function AvailabilityToggleCard({
  availability,
  queryKey,
  compact,
}: {
  availability: ProfileAvailability;
  queryKey?: readonly unknown[];
  compact: boolean;
}) {
  const qc = useQueryClient();
  const open = availability.state === "open";
  const toggle = useMutation({
    mutationFn: (next: boolean) => client.updateProfile({ availableForWork: next }),
    onSuccess: (_data, next) => {
      if (queryKey) void qc.invalidateQueries({ queryKey });
      toast.success(next ? "You're shown as available for work" : "Availability turned off");
    },
    onError: () => toast.error("Failed to update availability"),
  });

  const commitment = formatCommitment(availability.commitment);
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded border border-input bg-muted/15 px-3 py-2",
        compact && "flex-1",
      )}
    >
      <Switch
        checked={open}
        onCheckedChange={(next) => toggle.mutate(next)}
        disabled={toggle.isPending}
        aria-label="Available for work"
      />
      <div className="flex min-w-0 flex-col">
        <Text size="xs" bold className={cn("tracking-widest", open && "text-success")}>
          AVAILABLE FOR WORK
        </Text>
        <Text size="xs" variant="muted" className="truncate tracking-wider">
          {open
            ? ["Shown in the directory", commitment].filter(Boolean).join(" · ")
            : "Hidden from the directory"}
        </Text>
      </div>
    </div>
  );
}

function ActionRow({
  isOwner,
  onEditProfile,
  profile,
  compact,
}: {
  isOwner: boolean;
  onEditProfile: () => void;
  profile: ProfileViewModel;
  compact: boolean;
}) {
  const { session } = useStore(authStore);
  const signedIn = session?.user?.id != null;

  const onShare = () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/profile/${profile.handle}`;
    void navigator.clipboard?.writeText(url);
    toast.success("Profile link copied");
  };

  return (
    <div className={cn("flex items-center gap-2", compact && "shrink-0")}>
      {isOwner ? (
        <Button variant="outline" size="sm" onClick={onEditProfile}>
          <HugeiconsIcon icon={Edit02Icon} size={14} />
          <span className="tracking-widest">EDIT</span>
        </Button>
      ) : null}
      {!isOwner && profile.discordId ? (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <a
              href={`https://discord.com/users/${profile.discordId}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Message on Discord"
            />
          }
        >
          <HugeiconsIcon icon={DiscordIcon} size={14} />
          <span className="tracking-widest">MESSAGE</span>
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={onShare} aria-label="Share profile">
        <HugeiconsIcon icon={Share05Icon} size={14} />
        {isOwner ? null : <span className="tracking-widest">SHARE</span>}
      </Button>
      {!isOwner && signedIn ? <BlockToggle profileId={profile.profileId} /> : null}
    </div>
  );
}

/**
 * Block/unblock the profiled member — hides their comments from the
 * viewer everywhere and suppresses notifications both ways. Kept as a
 * quiet icon button so it doesn't compete with the primary actions.
 */
function BlockToggle({ profileId }: { profileId: string }) {
  const qc = useQueryClient();
  const { data: blockedUsers } = useQuery({
    queryKey: ["listBlockedUsers"],
    queryFn: () => client.listBlockedUsers({}),
  });
  const blocked = blockedUsers?.some((row) => row.userId === profileId) ?? false;

  const toggle = useMutation({
    mutationFn: () =>
      blocked ? client.unblockUser({ userId: profileId }) : client.blockUser({ userId: profileId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["listBlockedUsers"] });
      void qc.invalidateQueries({ queryKey: ["listComments"] });
      toast.success(blocked ? "Member unblocked" : "Member blocked");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Confirm
      variant="destructive"
      title="Block this member?"
      message="You'll stop seeing their comments."
      confirmText="BLOCK"
      bypass={blocked}
      onConfirm={() => toggle.mutate()}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={toggle.isPending}
        aria-label={blocked ? "Unblock member" : "Block member"}
        title={blocked ? "Unblock member" : "Block member"}
        className={cn(blocked && "text-destructive")}
      >
        <HugeiconsIcon icon={UserBlock01Icon} size={14} />
        {blocked ? <span className="tracking-widest">UNBLOCK</span> : null}
      </Button>
    </Confirm>
  );
}

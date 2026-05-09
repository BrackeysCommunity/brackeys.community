import { Edit02Icon, Location01Icon, Share05Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

import {
  formatCommitment,
  type ProfileAvailability,
  type ProfileBadge,
  type ProfileViewModel,
} from "./helpers";

interface ProfileHeroProps {
  profile: ProfileViewModel;
  isOwner: boolean;
  onEditProfile: () => void;
  /** Mobile compact mode. Layout collapses from "huge stacked title +
   * big square avatar to the right" to "small avatar tile inline-left
   * of stacked name+tag", matching the mobile wireframe. */
  compact?: boolean;
}

/**
 * Top-of-page hero. Two distinct layouts share one component because
 * the surrounding context (chips, one-liner, action set, stats row)
 * is the same in both modes — only the title block + avatar
 * arrangement flips.
 *
 * - Desktop: huge `clamp()` display name on the left, large square
 *   avatar tile pinned to the right.
 * - Mobile (`compact`): small avatar inline-left of the stacked name
 *   and outlined tag, with a status dot on the avatar's bottom-right
 *   and a `· they/them` meta line tucked under the name block.
 */
export function ProfileHero({
  profile,
  isOwner,
  onEditProfile,
  compact = false,
}: ProfileHeroProps) {
  return compact ? (
    <CompactHero profile={profile} isOwner={isOwner} onEditProfile={onEditProfile} />
  ) : (
    <WideHero profile={profile} isOwner={isOwner} onEditProfile={onEditProfile} />
  );
}

// ── Wide / desktop hero ────────────────────────────────────────────

function WideHero({
  profile,
  isOwner,
  onEditProfile,
}: {
  profile: ProfileViewModel;
  isOwner: boolean;
  onEditProfile: () => void;
}) {
  return (
    <div className="flex w-full items-stretch justify-between gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <DisplayNameStacked name={profile.name} tag={profile.tag} />
        <MetaChips profile={profile} />
        {profile.oneLiner ? (
          <Text monospace size="sm" variant="muted" className="max-w-prose tracking-wide">
            {profile.oneLiner}
          </Text>
        ) : null}
        <ActionRow
          isOwner={isOwner}
          onEditProfile={onEditProfile}
          handle={profile.handle}
          compact={false}
        />
      </div>
      <WideAvatarTile profile={profile} />
    </div>
  );
}

function DisplayNameStacked({ name, tag }: { name: string; tag: string | null }) {
  return (
    <div className="flex flex-col gap-10">
      <Heading
        as="h1"
        monospace
        className="text-[clamp(3rem,10vw,7rem)] leading-[0.85] tracking-tight text-foreground"
      >
        {name}
      </Heading>
      {tag ? <OutlineTag size="display">{tag}</OutlineTag> : null}
    </div>
  );
}

function WideAvatarTile({ profile }: { profile: ProfileViewModel }) {
  return (
    <div className="flex max-w-[18rem] flex-1 shrink-0 flex-col gap-2">
      <Well
        variant="default"
        className="relative flex aspect-square w-full items-center justify-center overflow-hidden"
      >
        {profile.avatar.imageUrl ? (
          <img
            src={profile.avatar.imageUrl}
            alt={profile.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <AvatarGlyph glyph={profile.avatar.glyph} size="display" />
        )}
      </Well>
      {profile.badges.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {profile.badges.map((b) => (
            <ProfileBadgeChip key={b.label} badge={b} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Mobile / compact hero ──────────────────────────────────────────

function CompactHero({
  profile,
  isOwner,
  onEditProfile,
}: {
  profile: ProfileViewModel;
  isOwner: boolean;
  onEditProfile: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Avatar (left) inline with the name + outlined tag (right) —
          this is the layout the wireframe uses; the avatar is a
          mid-size square thumbnail anchored to the same row as the
          headline and the meta chips sit below. */}
      <div className="grid grid-cols-[7.25rem_minmax(0,1fr)] items-start gap-3">
        <CompactAvatarTile profile={profile} online={hasOnlineBadge(profile.badges)} />
        <div className="flex min-w-0 flex-col">
          <Heading
            as="h1"
            monospace
            className="text-[2.6rem] leading-[0.9] tracking-tight text-foreground"
          >
            {profile.name}
          </Heading>
          {profile.tag ? (
            <div className="mt-2">
              <OutlineTag size="compact">{profile.tag}</OutlineTag>
            </div>
          ) : null}
          <MetaLine profile={profile} />
        </div>
      </div>

      <CompactChipsRow profile={profile} />

      {profile.oneLiner ? (
        <div className="border-l-2 border-accent/60 pl-3">
          <Text monospace size="sm" variant="muted" className="tracking-wide">
            {profile.oneLiner}
          </Text>
        </div>
      ) : null}

      <ActionRow isOwner={isOwner} onEditProfile={onEditProfile} handle={profile.handle} compact />
    </div>
  );
}

function CompactAvatarTile({ profile, online }: { profile: ProfileViewModel; online: boolean }) {
  return (
    <div className="relative aspect-square w-full">
      <Well
        variant="default"
        className="relative flex h-full w-full items-center justify-center overflow-hidden"
      >
        {profile.avatar.imageUrl ? (
          <img
            src={profile.avatar.imageUrl}
            alt={profile.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <AvatarGlyph glyph={profile.avatar.glyph} size="compact" />
        )}
      </Well>
      {online ? (
        // Online indicator overlapping the avatar's bottom-edge — the
        // wireframe's small green chip with a dot inside.
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
          <Badge
            variant="success"
            className="h-5 gap-1.5 border border-success/30 px-1.5 font-mono text-[9px] tracking-widest"
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full bg-success-foreground"
            />
          </Badge>
        </div>
      ) : null}
    </div>
  );
}

function MetaLine({ profile }: { profile: ProfileViewModel }) {
  // Mobile wireframe shows `· @handle · they/them` directly under the
  // tag — purely typographic, no chips. Pronouns is the more
  // meaningful side here; we trust handle is already in the
  // breadcrumb.
  if (!profile.pronouns) return null;
  return (
    <Text monospace size="xs" variant="muted" className="mt-1.5 tracking-widest">
      <span className="mr-1.5 text-success">●</span>
      {profile.pronouns.toUpperCase()}
    </Text>
  );
}

function CompactChipsRow({ profile }: { profile: ProfileViewModel }) {
  const { availability, location, joinedAt } = profile;
  const joinedLabel = joinedAt
    .toLocaleString(undefined, { month: "short", year: "numeric", timeZone: "UTC" })
    .toUpperCase();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AvailabilityChip availability={availability} />
      {location ? (
        <MetaChip>
          <HugeiconsIcon icon={Location01Icon} size={11} className="text-accent" />
          {location.toUpperCase()}
        </MetaChip>
      ) : null}
      <MetaChip>JOINED {joinedLabel}</MetaChip>
    </div>
  );
}

function hasOnlineBadge(badges: ProfileBadge[]): boolean {
  return badges.some((b) => b.variant === "online");
}

// ── Shared sub-components ──────────────────────────────────────────

function OutlineTag({
  children,
  size,
}: {
  children: React.ReactNode;
  size: "display" | "compact";
}) {
  // Sub-line tag under the display name. Uses the page's display
  // font (sans, not mono) for a softer counterpoint to the chunky
  // mono headline, filled in accent colour rather than stroked. Sits
  // at roughly a third of the display name's size so it reads as a
  // stylized suffix without competing with the name itself. Tight
  // line-height keeps multi-line taglines compact under the name.
  return (
    <span
      className={cn(
        "block font-semibold tracking-tight text-accent",
        size === "display" ? "text-[clamp(1rem,3vw,2.25rem)]" : "text-base",
        "leading-none",
      )}
    >
      {children}
    </span>
  );
}

function MetaChips({ profile }: { profile: ProfileViewModel }) {
  const { availability, pronouns, location, joinedAt } = profile;
  const joinedLabel = joinedAt
    .toLocaleString(undefined, { month: "short", year: "numeric", timeZone: "UTC" })
    .toUpperCase();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AvailabilityChip availability={availability} />
      {pronouns ? <MetaChip>{pronouns.toUpperCase()}</MetaChip> : null}
      {location ? (
        <MetaChip>
          <HugeiconsIcon icon={Location01Icon} size={12} className="text-accent" />
          {location.toUpperCase()}
        </MetaChip>
      ) : null}
      <MetaChip>JOINED {joinedLabel}</MetaChip>
    </div>
  );
}

function AvailabilityChip({ availability }: { availability: ProfileAvailability }) {
  const dotClass =
    availability.state === "open"
      ? "bg-success"
      : availability.state === "selective"
        ? "bg-warning"
        : "bg-muted-foreground";
  const labelMap: Record<ProfileAvailability["state"], string> = {
    open: "Available",
    selective: "Selective",
    closed: "Busy",
  };
  const commitmentLabel = formatCommitment(availability.commitment);
  return (
    <Badge variant="secondary" className="gap-2 font-mono text-[11px] tracking-widest uppercase">
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotClass)} aria-hidden />
      {labelMap[availability.state]}
      {commitmentLabel ? (
        <>
          <span aria-hidden className="opacity-60">
            ·
          </span>
          <span className="opacity-80">{commitmentLabel}</span>
        </>
      ) : null}
    </Badge>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className="gap-1.5 font-mono text-[11px] tracking-widest uppercase">
      {children}
    </Badge>
  );
}

function ActionRow({
  isOwner,
  onEditProfile,
  handle,
  compact,
}: {
  isOwner: boolean;
  onEditProfile: () => void;
  handle: string;
  compact: boolean;
}) {
  const onShare = () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/profile/${handle}`;
    void navigator.clipboard?.writeText(url);
  };

  if (compact) {
    return (
      <div className="grid grid-cols-[1fr_auto] items-stretch gap-2">
        {isOwner ? (
          <Button
            variant="default"
            size="lg"
            onClick={onEditProfile}
            className="font-mono tracking-widest"
          >
            <HugeiconsIcon icon={Edit02Icon} size={14} />
            EDIT PROFILE
          </Button>
        ) : (
          <span />
        )}
        <Button variant="outline" size="lg" onClick={onShare} className="font-mono tracking-widest">
          <HugeiconsIcon icon={Share05Icon} size={14} />
          SHARE
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isOwner ? (
        <Button variant="default" size="sm" onClick={onEditProfile}>
          <HugeiconsIcon icon={Edit02Icon} size={14} />
          <span className="font-mono tracking-widest">EDIT PROFILE</span>
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={onShare}>
        <HugeiconsIcon icon={Share05Icon} size={14} />
        <span className="font-mono tracking-widest">SHARE</span>
      </Button>
    </div>
  );
}

function AvatarGlyph({ glyph, size }: { glyph: string; size: "display" | "compact" }) {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 bg-[image:repeating-linear-gradient(135deg,transparent_0_8px,color-mix(in_srgb,var(--color-foreground)_8%,transparent)_8px_10px)]"
      />
      <span
        aria-hidden
        className={cn(
          "relative font-mono leading-none font-bold tracking-tight",
          "text-transparent [-webkit-text-stroke:3px_var(--accent)]",
          size === "display" ? "text-[12rem]" : "text-[5rem]",
        )}
      >
        {glyph}
      </span>
    </>
  );
}

function ProfileBadgeChip({ badge }: { badge: ProfileBadge }) {
  const variant: "secondary" | "warning" | "success" =
    badge.variant === "online" ? "success" : badge.variant === "winner" ? "warning" : "secondary";
  const glyph = badge.variant === "online" ? "●" : badge.variant === "winner" ? "♛" : "■";
  return (
    <Badge variant={variant} className="font-mono text-[10px] tracking-widest uppercase">
      <span aria-hidden className="mr-1">
        {glyph}
      </span>
      {badge.label}
    </Badge>
  );
}

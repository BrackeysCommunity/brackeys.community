import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useHoverPlay } from "@/lib/hooks/use-hover-play";
import { hoverPlaySources } from "@/lib/still-image";
import { cn } from "@/lib/utils";

/** One transform bucket for every avatar frame: the largest render is
 * 64px, so 128 covers 2× displays, and a single width means a person's
 * avatar is one cached asset across every surface instead of one per
 * `size` prop. Non-transformable sources (Discord, GitHub) pass through. */
const AVATAR_TRANSFORM = { width: 128 };

interface UserAvatarProps {
  avatarUrl: string | null | undefined;
  /** Drives the initial shown when there is no image, and the alt text. */
  username: string | null | undefined;
  /** Edge length in px. Sizes are per-surface here (6/8/9/…) rather than a
   * fixed scale, because these sit inline with text of varying size. */
  size?: number;
  /** `square` is the house frame used on collab and notification rows;
   * `round` is for chrome that reads as a profile chip. */
  shape?: "square" | "round";
  /** Let an animated avatar loop unprompted. Off everywhere by default. */
  autoplay?: boolean;
  className?: string;
}

/**
 * Image-or-initial avatar, one implementation. Animated (gif) avatars hold their
 * first frame until hovered, and the playing copy layers over the still so the
 * first hover doesn't blink while it loads.
 */
export function UserAvatar({
  avatarUrl,
  username,
  size = 32,
  shape = "square",
  autoplay = false,
  className,
}: UserAvatarProps) {
  const square = shape === "square";
  const rounding = square ? "rounded-none" : "rounded-full";
  const initial = (username?.trim()[0] ?? "?").toUpperCase();

  // `animated` is null unless the source animates *and* a still exists;
  // one we can't freeze is left to play. Both copies ride the avatar
  // transform, so a hover decodes an avatar-sized gif, not the master.
  const sources = avatarUrl ? hoverPlaySources(avatarUrl, AVATAR_TRANSFORM) : null;
  const still = (autoplay ? sources?.rendered : sources?.still) ?? null;
  const animated = (!autoplay ? sources?.animated : null) ?? null;
  const { playing, handlers } = useHoverPlay(animated);

  return (
    <Avatar
      // The primitive draws its own hairline frame via `after:` — no second
      // border here, and the shape has to be passed through to it.
      className={cn("shrink-0", rounding, square && "after:rounded-none", className)}
      style={{ width: size, height: size }}
      {...handlers}
    >
      {still ? (
        <AvatarImage src={still} alt="" loading="lazy" decoding="async" className={rounding} />
      ) : null}
      {playing && animated ? (
        <img
          src={animated}
          alt=""
          aria-hidden
          className={cn("absolute inset-0 size-full object-cover", rounding)}
        />
      ) : null}
      <AvatarFallback
        className={cn("bg-muted font-bold text-muted-foreground", rounding)}
        // Proportional to the frame, rather than a text-size class per call site.
        style={{ fontSize: Math.max(10, Math.round(size * 0.4)) }}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}

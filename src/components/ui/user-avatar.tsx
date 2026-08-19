import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useHoverPlay } from "@/hooks/use-hover-play";
import { stillImageUrl } from "@/lib/still-image";
import { cn } from "@/lib/utils";

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

  // Null unless the source animates *and* a still exists; one we can't freeze
  // is left to play.
  const still = avatarUrl ? stillImageUrl(avatarUrl) : null;
  const animated = !autoplay && avatarUrl && still !== avatarUrl ? avatarUrl : null;
  const { playing, handlers } = useHoverPlay(animated);

  return (
    <Avatar
      // The primitive draws its own hairline frame via `after:` — no second
      // border here, and the shape has to be passed through to it.
      className={cn("shrink-0", rounding, square && "after:rounded-none", className)}
      style={{ width: size, height: size }}
      {...handlers}
    >
      {still ? <AvatarImage src={still} alt="" className={rounding} /> : null}
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

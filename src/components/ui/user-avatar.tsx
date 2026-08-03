import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  className?: string;
}

/**
 * Image-or-initial avatar, one implementation.
 *
 * There were five hand-rolled versions of this: two built on the `Avatar`
 * primitives with an initial fallback, three that rendered a bare `<img>`
 * inside a framed box and simply showed an empty box when the user had no
 * image. This wraps the primitives so every surface gets the initial.
 */
export function UserAvatar({
  avatarUrl,
  username,
  size = 32,
  shape = "square",
  className,
}: UserAvatarProps) {
  const square = shape === "square";
  const rounding = square ? "rounded-none" : "rounded-full";
  const initial = (username?.trim()[0] ?? "?").toUpperCase();

  return (
    <Avatar
      // The primitive draws its own hairline frame via `after:`, so there is
      // no second border here — two stacked frames read as a box around the
      // avatar rather than an edge on it. The frame follows the shape: the
      // primitive's `after:` is round by default, which put a circle outline
      // around every square avatar.
      className={cn("shrink-0", rounding, square && "after:rounded-none", className)}
      style={{ width: size, height: size }}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" className={rounding} /> : null}
      <AvatarFallback
        className={cn("bg-muted font-bold text-muted-foreground", rounding)}
        // Keep the initial proportional to the frame rather than stepping
        // through text-size classes at every call site.
        style={{ fontSize: Math.max(10, Math.round(size * 0.4)) }}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}

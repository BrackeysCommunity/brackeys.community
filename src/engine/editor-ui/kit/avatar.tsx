import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type { CSSProperties } from "react";

import { cx } from "./cx";

/** A face: the image when it loads, else the name's initial; `ring` is the peer's colour. */
export function Avatar({
  name,
  avatarUrl,
  size = 24,
  ring,
  className,
}: {
  name: string | null | undefined;
  avatarUrl?: string | null;
  size?: number;
  ring?: string;
  className?: string;
}) {
  const initial = (name?.trim()[0] ?? "?").toUpperCase();
  const style: CSSProperties & Record<"--je-avatar-ring", string | undefined> = {
    width: size,
    height: size,
    fontSize: Math.max(9, Math.round(size * 0.42)),
    "--je-avatar-ring": ring,
  };
  return (
    <AvatarPrimitive.Root
      className={cx("je-avatar", className)}
      data-ring={ring ? "" : undefined}
      style={style}
      aria-label={name ?? undefined}
      role="img"
    >
      {avatarUrl ? (
        <AvatarPrimitive.Image src={avatarUrl} alt="" className="je-avatar-img" />
      ) : null}
      <AvatarPrimitive.Fallback className="je-avatar-initial" aria-hidden>
        {initial}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

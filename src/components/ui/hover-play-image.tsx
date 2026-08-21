import { useEffect, useRef, useState } from "react";

import { useHoverPlay } from "@/hooks/use-hover-play";
import { type ItchImageOpts } from "@/lib/itch-image";
import { hoverPlaySources, isAnimatedImageUrl } from "@/lib/still-image";
import { cn } from "@/lib/utils";

interface HoverPlayImageProps {
  /** Untransformed source URL — the transform (plus `anim: false` for the
   * still) is applied here, not by the caller. */
  src: string;
  transform?: ItchImageOpts;
  alt?: string;
  /** Applied to both the still and the playing overlay, so the two render
   * identically. Needs a positioned ancestor: the overlay is `absolute
   * inset-0` over the still. */
  className?: string;
  loading?: "lazy" | "eager";
  onError?: () => void;
}

/**
 * Art that may be an animated gif, held on its first frame until hovered —
 * the `UserAvatar` gif treatment for jam banners and covers. The playing
 * copy layers over the still, and the still fades out only once the copy
 * has loaded, so the first hover never blinks and a transparent or
 * offset gif never shows a frozen ghost of itself underneath. Under
 * reduced motion nothing plays at all.
 *
 * When no frozen twin exists (transformer gate off, foreign host), the
 * first frame is drawn to a canvas instead — `drawImage` of an animated
 * image paints frame one — so the hold works without Cloudflare.
 *
 * Hover surface: the image itself by default. A card that sets
 * `data-hover-play-group` on an ancestor becomes the surface instead, so
 * fully-interactive cards play their art from anywhere on the card.
 */
export function HoverPlayImage({
  src,
  transform,
  alt = "",
  className,
  loading,
  onError,
}: HoverPlayImageProps) {
  const { rendered, still, animated } = hoverPlaySources(src, transform);
  const canvasFrozen = animated == null && isAnimatedImageUrl(src);
  const playSrc = animated ?? (canvasFrozen ? rendered : null);
  const { playing, armed, play, stop } = useHoverPlay(playSrc);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stillRef = useRef<HTMLElement | null>(null);
  const groupRef = useRef<Element | null>(null);
  // Ref'd so callers can pass an inline handler without re-running the
  // load effect (and re-fetching the image) every render.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // The still stays visible under the overlay until the playing copy has
  // pixels; hidden with opacity (not visibility) so it keeps receiving
  // the pointer events that end the hover. Loading is remembered per
  // source, so only the first-ever hover waits.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const overlayReady = playSrc != null && loadedSrc === playSrc;

  useEffect(() => {
    if (!armed) return;
    const group = stillRef.current?.closest("[data-hover-play-group]") ?? null;
    groupRef.current = group;
    if (!group) return;
    group.addEventListener("pointerenter", play);
    group.addEventListener("pointerleave", stop);
    return () => {
      groupRef.current = null;
      group.removeEventListener("pointerenter", play);
      group.removeEventListener("pointerleave", stop);
    };
  }, [armed, play, stop]);

  useEffect(() => {
    if (!canvasFrozen) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
    };
    image.onerror = () => {
      if (!cancelled) onErrorRef.current?.();
    };
    image.src = rendered;
    return () => {
      cancelled = true;
    };
  }, [canvasFrozen, rendered]);

  const stillClass = cn(className, playing && overlayReady && "opacity-0");
  const selfHandlers = armed
    ? {
        onPointerEnter: play,
        onPointerLeave: (event: React.PointerEvent) => {
          // Crossing off the art while still inside the group keeps it
          // playing — the group's own leave is what ends it.
          const group = groupRef.current;
          if (group && event.relatedTarget instanceof Node && group.contains(event.relatedTarget))
            return;
          stop();
        },
      }
    : {};

  return (
    <>
      {canvasFrozen ? (
        <canvas
          ref={(el) => {
            canvasRef.current = el;
            stillRef.current = el;
          }}
          role={alt ? "img" : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt === "" || undefined}
          {...selfHandlers}
          className={stillClass}
        />
      ) : (
        <img
          ref={(el) => {
            stillRef.current = el;
          }}
          src={still}
          alt={alt}
          aria-hidden={alt === "" || undefined}
          loading={loading}
          decoding="async"
          onError={onError}
          {...selfHandlers}
          className={stillClass}
        />
      )}
      {playing && playSrc ? (
        <img
          src={playSrc}
          alt=""
          aria-hidden
          decoding="async"
          onLoad={() => setLoadedSrc(playSrc)}
          className={cn(className, "pointer-events-none absolute inset-0")}
        />
      ) : null}
    </>
  );
}

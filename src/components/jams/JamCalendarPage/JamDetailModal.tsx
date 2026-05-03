import DOMPurify from "dompurify";
import { AnimatePresence, motion } from "framer-motion";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Grainient } from "@/components/ui/grainient";
import { Heading, Link, Text } from "@/components/ui/typography";
import { useThemeChartColors } from "@/lib/hooks/use-theme-chart-colors";
import { durationDays, formatJamShortDates } from "@/lib/jam-countdown";
import { cn } from "@/lib/utils";

import { type JamFromList, jamPaletteColors, jamUrl } from "./helpers";

interface JamDetailModalProps {
  jam: JamFromList | null;
  /** Stable layoutId suffix that must match the source row that
   * launched the modal — drives the shared-banner animation. */
  layoutKey: string | null;
  onClose: () => void;
}

// Modal-side (open) — the shared-layout target. Smooth, leisurely
// spring as the card unfolds from its row.
const MODAL_TRANSITION = { type: "spring" as const, duration: 0.45, bounce: 0.18 };
// During the layout transition the banner cross-frames between two very
// different aspect ratios. A short blur masks any sub-pixel jank, then
// fades to clean — the same trick iOS uses on detail-from-list pushes.
const BLUR_TRANSITION = { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const };

/**
 * Spotlight detail surface for a single jam, launched from a timeline
 * row. The banner image carries a shared `layoutId` so it morphs from
 * its in-row position to the top of the modal; the rest of the modal
 * (chrome, body, scroll area) fades in around it. A short blur ramps
 * out as the layout settles to hide compositing seams.
 */
export function JamDetailModal({ jam, layoutKey, onClose }: JamDetailModalProps) {
  const open = jam != null && layoutKey != null;

  // Lock body scroll while the spotlight is open so wheel/touch input
  // doesn't keep scrolling the timeline behind the backdrop.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc to dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
            style={{ touchAction: "none" }}
          />
          <motion.div
            key={`modal-${layoutKey}`}
            layoutId={`tl-row-${layoutKey}`}
            transition={MODAL_TRANSITION}
            style={{ borderRadius: 12 }}
            className="fixed inset-0 z-50 m-auto h-fit max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] cursor-default overflow-hidden border border-[var(--emboss-shadow)] bg-card text-foreground shadow-[0_16px_0_0_var(--emboss-shadow)] [--emboss-shadow:var(--muted-foreground)]"
          >
            <ModalContent jam={jam} layoutKey={layoutKey} onClose={onClose} />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function ModalContent({
  jam,
  layoutKey,
  onClose,
}: {
  jam: JamFromList;
  layoutKey: string;
  onClose: () => void;
}) {
  const cohosts = jam.hosts.slice(1);
  return (
    <motion.div
      // Blur ramps from heavy → 0 on enter and back on exit so any jitter
      // during the row → modal layout morph is masked. The body content
      // also rides this so it reveals smoothly behind the banner.
      initial={{ filter: "blur(12px)" }}
      animate={{ filter: "blur(0px)" }}
      exit={{ filter: "blur(12px)" }}
      transition={BLUR_TRANSITION}
      className="flex max-h-[85vh] flex-col"
    >
      <div className="relative h-48 w-full shrink-0 overflow-hidden bg-muted/40">
        {jam.bannerUrl ? (
          <>
            {/* Blurred-cover backdrop fills the frame in the
                dominant color of the art so letterboxed banners don't
                show plain bars on the sides. The crisp banner sits on
                top via `object-contain` so we never crop or distort
                the actual artwork. */}
            <img
              src={jam.bannerUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-125 object-cover blur-xl saturate-150"
            />
            <motion.img
              layoutId={`tl-banner-${layoutKey}`}
              transition={MODAL_TRANSITION}
              src={jam.bannerUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-contain"
            />
          </>
        ) : (
          <ModalGrainientBanner layoutKey={layoutKey} jamId={jam.jamId} />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 rounded-md bg-background/80 px-2 py-1 font-mono text-[10px] tracking-widest text-foreground backdrop-blur-sm transition-colors hover:bg-background"
        >
          ESC
        </button>
      </div>

      <motion.div
        // Slight delay so the body fades in *after* the layout morph
        // begins, never before — keeps the focal element (the banner)
        // visually leading the transition.
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <OverlayScrollbarsComponent
          element="div"
          className="min-h-0 flex-1"
          options={{
            scrollbars: {
              // Dual-class: `os-theme-dark` ships the structural rules
              // (handle dimensions, track layout), `os-theme-accent`
              // tints just the handle color to match the active theme's
              // accent. Without the dark base, no scrollbar renders.
              theme: "os-theme-dark os-theme-accent",
              autoHide: "scroll",
              autoHideDelay: 600,
            },
          }}
          defer
        >
          <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className="font-mono text-[10px] tracking-widest uppercase"
              >
                {jam.hosts[0]?.name ?? "COMMUNITY"}
              </Badge>
              {jam.hashtag && (
                <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
                  {jam.hashtag.toUpperCase()}
                </Text>
              )}
            </div>

            <Heading as="h2" className="text-2xl leading-tight">
              {jam.title}
            </Heading>

            <Text monospace size="xs" variant="muted" className="tracking-widest">
              {formatJamShortDates(jam.startsAt, jam.endsAt) ?? "TBA"}
              {durationDays(jam.startsAt, jam.endsAt) &&
                ` · ${durationDays(jam.startsAt, jam.endsAt)}`}
              {cohosts.length > 0 && ` · ${cohosts.map((h) => h.name).join(", ")}`}
            </Text>

            {jam.contentHtml ? (
              <RichHtml html={jam.contentHtml} className="mt-2" />
            ) : (
              <Text variant="muted" size="sm" className="mt-2 italic">
                No description provided.
              </Text>
            )}

            <Link
              href={jamUrl(jam.slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 self-start font-mono text-xs tracking-widest uppercase"
            >
              View on itch.io →
            </Link>
          </div>
        </OverlayScrollbarsComponent>
      </motion.div>
    </motion.div>
  );
}

/** Modal-side banner for jams that don't have a poster image: renders
 * the same `Grainient` colorway the row's `BannerThumb` uses (palette
 * is keyed by `jamId` so the colors don't re-roll across the layout
 * morph). The wrapping `motion.div` carries the shared `layoutId` so
 * framer animates the surface from the row's thumb position to the
 * modal's full-width banner slot. */
function ModalGrainientBanner({ layoutKey, jamId }: { layoutKey: string; jamId: number }) {
  const palette = useThemeChartColors();
  const colors = useMemo(() => jamPaletteColors(palette, jamId), [palette, jamId]);
  return (
    <motion.div
      layoutId={`tl-banner-${layoutKey}`}
      transition={MODAL_TRANSITION}
      className="absolute inset-0"
    >
      <Grainient color1={colors[0]} color2={colors[1]} color3={colors[0]} />
    </motion.div>
  );
}

/** Renders a sanitized HTML string with the same typographic treatment
 * as `MarkedText`, so jam descriptions read consistently with the
 * markdown-driven surfaces elsewhere on the site. */
function RichHtml({ html, className }: { html: string; className?: string }) {
  const safe = useMemo(() => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }), [html]);
  return (
    <div
      className={cn(
        "text-sm/relaxed text-foreground",
        "[&_em]:italic [&_strong]:font-bold",
        "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent/80",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3 [&_pre]:text-xs",
        "[&_pre_code]:border-none [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:mb-1",
        "[&_p]:mb-2 [&_p:last-child]:mb-0",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold",
        "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-bold",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",
        "[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded",
        "[&_iframe]:my-3 [&_iframe]:max-w-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

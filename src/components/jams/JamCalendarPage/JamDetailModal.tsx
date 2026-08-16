import { Link as RouterLink } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

import { JamTeamCta } from "@/components/jams/JamTeamCta";
import { JamWatchToggle } from "@/components/jams/JamWatchToggle";
import { Badge } from "@/components/ui/badge";
import { Grainient } from "@/components/ui/grainient";
import { Heading, Link, RichHtml, Text } from "@/components/ui/typography";
import { useReducedMotion } from "@/lib/hooks/use-app-settings";
import { useThemeChartColors } from "@/lib/hooks/use-theme-chart-colors";
import { BACKDROP_TRANSFORM, BOARD_BANNER_TRANSFORM, itchImageUrl } from "@/lib/itch-image";
import { durationDays, formatJamShortDates } from "@/lib/jam-countdown";
import { hostName, jamLinkParams, jamUrl } from "@/lib/jam-links";
import { jamPaletteColors } from "@/lib/jam-palette";
import { EASE_OUT } from "@/lib/motion";

import { type JamFromList, jamPhase, jamStats } from "./helpers";

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
const BLUR_TRANSITION = { duration: 0.35, ease: EASE_OUT };

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
            className="fixed inset-0 z-50 m-auto h-fit max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] cursor-default overflow-hidden border border-[var(--emboss-shadow)] bg-card text-foreground shadow-[0_6px_0_0_var(--emboss-shadow)] [--emboss-shadow:var(--muted-foreground)]"
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
              src={itchImageUrl(jam.bannerUrl, BACKDROP_TRANSFORM)}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-125 object-cover blur-xl saturate-150"
            />
            <motion.img
              layoutId={`tl-banner-${layoutKey}`}
              transition={MODAL_TRANSITION}
              // Same transform as the board's BannerMedia — the layoutId
              // morph must land on the identical URL to avoid a re-fetch.
              src={itchImageUrl(jam.bannerUrl, BOARD_BANNER_TRANSFORM)}
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
        transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.1 }}
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
              <Badge variant="secondary" size="label" className="uppercase">
                {hostName(jam)}
              </Badge>
              {jam.hashtag && (
                <Text size="xs" variant="muted" className="tracking-widest uppercase">
                  {jam.hashtag.toUpperCase()}
                </Text>
              )}
            </div>

            {/* The title is the permalink: the modal is a quick-look, and
                the jam's real page is where a link someone shares has to
                land. */}
            <Heading as="h2" className="text-2xl leading-tight">
              <RouterLink
                to="/jams/$jamSlug"
                params={jamLinkParams(jam)}
                className="transition-colors hover:text-primary"
              >
                {jam.title}
              </RouterLink>
            </Heading>

            <Text size="xs" variant="muted" className="tracking-widest">
              {formatJamShortDates(jam.startsAt, jam.endsAt) ?? "TBA"}
              {durationDays(jam.startsAt, jam.endsAt) &&
                ` · ${durationDays(jam.startsAt, jam.endsAt)}`}
              {cohosts.length > 0 && ` · ${cohosts.map((h) => h.name).join(", ")}`}
            </Text>

            <JamStatsLine jam={jam} />

            {jam.contentHtml ? (
              <RichHtml html={jam.contentHtml} className="mt-2" />
            ) : (
              <Text variant="muted" size="sm" className="mt-2 italic">
                No description provided.
              </Text>
            )}

            <JamWatchToggle jamId={jam.jamId} phase={jamPhase(jam, new Date())} className="mt-3" />

            <JamTeamCta jam={jam} className="mt-3" />

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <RouterLink
                to="/jams/$jamSlug"
                params={jamLinkParams(jam)}
                className="text-xs font-bold tracking-widest text-primary uppercase hover:underline"
              >
                Full page →
              </RouterLink>
              <Link
                href={jamUrl(jam.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs tracking-widest uppercase"
              >
                View on itch.io →
              </Link>
            </div>
          </div>
        </OverlayScrollbarsComponent>
      </motion.div>
    </motion.div>
  );
}

/** Every participation number we have for the jam, in one line. */
function JamStatsLine({ jam }: { jam: JamFromList }) {
  const stats = jamStats(jam);
  if (stats.length === 0) return null;
  return (
    <Text size="xs" bold className="tracking-widest tabular-nums">
      {stats.map((s) => `${s.value.toLocaleString()} ${s.label}`).join(" · ")}
    </Text>
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
  const reduced = useReducedMotion();
  const colors = useMemo(() => jamPaletteColors(palette, jamId), [palette, jamId]);
  return (
    <motion.div
      layoutId={`tl-banner-${layoutKey}`}
      transition={MODAL_TRANSITION}
      className="absolute inset-0"
    >
      <Grainient color1={colors[0]} color2={colors[1]} color3={colors[0]} paused={reduced} />
    </motion.div>
  );
}

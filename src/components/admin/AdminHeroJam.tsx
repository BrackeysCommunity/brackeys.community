import { PinIcon, PinOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { AdminEmpty, AdminRow, AdminSection, Field } from "@/components/admin/AdminUI";
import { heroPinApplies } from "@/components/home/hero-jam";
import {
  BANNER_TRANSITION,
  JamBannerArt,
  JamBannerBackdrop,
  JamCarouselDots,
  JamStateBadge,
} from "@/components/home/jam-banner";
import { useJamGradient } from "@/components/jams/JamCalendarPage/board/use-jam-color";
import {
  type JamFromList,
  jamMatchesSearch,
  jamSignal,
} from "@/components/jams/JamCalendarPage/helpers";
import {
  boardJamsQueryOptions,
  heroPinsQueryOptions,
  homeJamsFrom,
} from "@/components/jams/JamCalendarPage/use-jam-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { timeAgo } from "@/lib/format-time";
import { useReducedMotion } from "@/lib/hooks/use-app-settings";
import useDateNow from "@/lib/hooks/use-date-now";
import { effectiveJamState } from "@/lib/jam-countdown";
import { hostName, jamLinkParams, jamMonthDay } from "@/lib/jam-links";
import { EASE_OUT } from "@/lib/motion";
import { toastMutationError } from "@/lib/mutation-errors";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

/** Enough hits to find the jam you had in mind, not a second jam board. */
const SEARCH_LIMIT = 8;

/**
 * Staff curation for the home hero. The rules live in `heroJamSlides`; this
 * panel shows the rotation as it stands, what is queued, and what aged out.
 */
export function AdminHeroJam() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const now = useDateNow();
  const nowDate = useMemo(() => new Date(now), [now]);

  const board = useQuery(boardJamsQueryOptions());
  const pinsQuery = useQuery(heroPinsQueryOptions());

  const jams = useMemo(() => board.data?.jams ?? [], [board.data]);
  const pins = useMemo(() => pinsQuery.data?.pins ?? [], [pinsQuery.data]);

  // The same call the home page makes, so this reads what `/` actually shows.
  const heroSlides = useMemo(() => homeJamsFrom(jams, now, pins).heroSlides, [jams, now, pins]);

  const byId = useMemo(() => new Map(jams.map((jam) => [jam.jamId, jam])), [jams]);
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.jamId)), [pins]);

  const toggle = useMutation({
    mutationFn: (input: { jamId: number; pinned: boolean }) => client.setJamHeroPin(input),
    // Written into the cache, not invalidated: a refetch through the 30s
    // edge cache can return the pre-write copy and visibly undo the click.
    onSuccess: (row, input) => {
      toast.success(input.pinned ? "Pinned to the home hero." : "Unpinned.");
      queryClient.setQueryData(heroPinsQueryOptions().queryKey, (prev) => {
        const rest = (prev?.pins ?? []).filter((p) => p.jamId !== input.jamId);
        return { pins: input.pinned ? [row, ...rest] : rest };
      });
    },
    onError: toastMutationError("admin.hero_pin"),
  });

  const trimmed = search.trim();
  // Only jams a pin could actually promote — live or upcoming.
  const candidates = useMemo(
    () =>
      trimmed.length <= 1
        ? []
        : jams
            .filter((jam) => heroPinApplies(jam, nowDate) && jamMatchesSearch(jam, trimmed))
            .sort((a, b) => jamSignal(b, nowDate).value - jamSignal(a, nowDate).value)
            .slice(0, SEARCH_LIMIT),
    [jams, trimmed, nowDate],
  );

  const isPending = board.isPending || pinsQuery.isPending;

  // Exactly the deck the landing page rotates through: a Brackeys jam
  // first whenever one is live or upcoming, staff picks behind it.
  const slides: HeroSlide[] = heroSlides.map((slide) => ({
    jam: slide.jam,
    status: HERO_SOURCE[slide.source],
    pinnedAt: pins.find((p) => p.jamId === slide.jam.jamId)?.pinnedAt ?? null,
    action:
      slide.source === "pinned" ? (
        <PinButton
          pinned
          busy={toggle.isPending}
          onClick={() => toggle.mutate({ jamId: slide.jam.jamId, pinned: false })}
        />
      ) : slide.source === "ranked" ? (
        <PinButton
          pinned={false}
          busy={toggle.isPending}
          onClick={() => toggle.mutate({ jamId: slide.jam.jamId, pinned: true })}
        />
      ) : undefined,
  }));

  return (
    <div className="flex flex-col gap-8">
      <AdminSection
        title="Home hero"
        hint="The rotation the landing page leads with right now. A Brackeys jam always fronts it; staff picks join behind."
      >
        {isPending ? (
          <Skeleton className="h-56 w-full" />
        ) : slides.length === 0 ? (
          <AdminEmpty>Nothing is live or upcoming, so the hero has no jam to show.</AdminEmpty>
        ) : (
          <HeroCarousel slides={slides} now={nowDate} />
        )}
      </AdminSection>

      <AdminSection
        title="Pinned jams"
        count={isPending ? undefined : pins.length}
        hint="Newest pin wins. A pin stops applying once its jam ends, and the next one down takes over on its own — nothing has to be unpinned on time."
      >
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : pins.length === 0 ? (
          <AdminEmpty>
            Nothing is pinned. With no Brackeys jam running, the hero falls to whichever jam has the
            most joins.
          </AdminEmpty>
        ) : (
          <div className="flex flex-col gap-3">
            {pins.map((pin) => {
              // A pin can outlive its jam's spell on the board — fall back to
              // the pin's own jam summary rather than dropping the row.
              const jam = byId.get(pin.jamId);
              const applies = jam ? heroPinApplies(jam, nowDate) : false;
              const inRotation = heroSlides.some((slide) => slide.jam.jamId === pin.jamId);
              return (
                <JamRow
                  key={pin.jamId}
                  jam={jam ?? pin}
                  now={nowDate}
                  muted={!applies}
                  pinnedAt={pin.pinnedAt}
                  status={
                    inRotation
                      ? { label: "IN ROTATION", tone: "default" }
                      : applies
                        ? { label: "QUEUED", tone: "secondary" }
                        : { label: "ENDED", tone: "outline" }
                  }
                  action={
                    <PinButton
                      pinned
                      busy={toggle.isPending}
                      onClick={() => toggle.mutate({ jamId: pin.jamId, pinned: false })}
                    />
                  }
                />
              );
            })}
          </div>
        )}
      </AdminSection>

      <AdminSection
        title="Pin a jam"
        hint="Search live and upcoming jams by title, hashtag, or host."
      >
        <Field label="Search" htmlFor="admin-hero-jam-search">
          <Input
            id="admin-hero-jam-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. GMTK"
            maxLength={100}
          />
        </Field>

        {trimmed.length <= 1 ? null : board.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : candidates.length === 0 ? (
          <AdminEmpty>No live or upcoming jam matches “{trimmed}”.</AdminEmpty>
        ) : (
          <div className="flex flex-col gap-3">
            {candidates.map((jam) => {
              const pinned = pinnedIds.has(jam.jamId);
              return (
                <JamRow
                  key={jam.jamId}
                  jam={jam}
                  now={nowDate}
                  action={
                    <PinButton
                      pinned={pinned}
                      busy={toggle.isPending}
                      onClick={() => toggle.mutate({ jamId: jam.jamId, pinned: !pinned })}
                    />
                  }
                />
              );
            })}
          </div>
        )}
      </AdminSection>
    </div>
  );
}

type RowStatus = { label: string; tone: "default" | "secondary" | "outline" };

const HERO_SOURCE: Record<"brackeys" | "pinned" | "ranked", RowStatus> = {
  brackeys: { label: "BRACKEYS JAM", tone: "default" },
  pinned: { label: "STAFF PICK", tone: "default" },
  ranked: { label: "TOP RANKED", tone: "secondary" },
};

interface HeroSlide {
  jam: JamFromList;
  status: RowStatus;
  pinnedAt?: Date | string | null;
  action?: React.ReactNode;
}

/** How long each slide holds before the carousel moves on. */
const SLIDE_MS = 6000;

const CROSSFADE = { duration: 0.2, ease: EASE_OUT };

/**
 * The hero rotation as the home page shows it: one static well, the same
 * banner stack the landing hero renders, one slide per jam in the deck.
 * Auto-advances only with more than one slide; hover pauses it, reduced
 * motion disables it.
 */
function HeroCarousel({ slides, now }: { slides: HeroSlide[]; now: Date }) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);

  // Modulo at read time: unpinning can shrink the deck under a live index.
  const active = slides[index % slides.length]!;
  const jam = active.jam;

  useEffect(() => {
    if (reduced || paused || slides.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), SLIDE_MS);
    return () => clearInterval(timer);
  }, [reduced, paused, slides.length]);

  const [bgColor1, bgColor2] = useJamGradient(jam);
  const state = effectiveJamState(jam.startsAt, jam.endsAt, now);
  const signal = jamSignal(jam, now);
  const start = jamMonthDay(jam.startsAt);
  const end = jamMonthDay(jam.endsAt);

  return (
    <Well
      notchOpts
      className="overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative h-40 shrink-0 overflow-hidden sm:h-48">
        <JamBannerBackdrop
          jamId={jam.jamId}
          bannerUrl={jam.bannerUrl}
          bgColor1={bgColor1}
          bgColor2={bgColor2}
        />
        {/* popLayout: `wait` would leave the backdrop bare between slides. */}
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={jam.jamId}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: -32 }}
            transition={BANNER_TRANSITION}
            className="absolute inset-0"
          >
            <JamBannerArt jam={jam} isCompact />
          </motion.div>
        </AnimatePresence>

        <div className="pointer-events-none absolute top-3 left-3 z-20">
          <JamStateBadge state={state} />
        </div>

        {slides.length > 1 && (
          <JamCarouselDots
            slides={slides.map((slide) => slide.jam)}
            active={index % slides.length}
            onSelect={setIndex}
            className="absolute bottom-3 left-3 z-20"
          />
        )}
      </div>

      {/* Static frame, crossfading readout — the slide owns only the words. */}
      <div className="border-t border-deboss-shadow/60 p-4">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={jam.jamId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={CROSSFADE}
            className="flex flex-wrap items-start justify-between gap-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <RouterLink
                to="/jams/$jamSlug"
                params={jamLinkParams(jam)}
                className="min-w-0 text-sm font-medium hover:text-primary hover:underline"
              >
                {jam.title}
              </RouterLink>
              <div className="flex flex-wrap items-center gap-2">
                <Badge size="label" variant={active.status.tone}>
                  {active.status.label}
                </Badge>
                <MicroLabel as="span" className="text-muted-foreground">
                  {hostName(jam)}
                </MicroLabel>
                <MicroLabel as="span" className="text-muted-foreground">
                  {start.month} {start.day}
                  {jam.endsAt ? ` → ${end.month} ${end.day}` : ""}
                </MicroLabel>
                <MicroLabel as="span" className="text-muted-foreground">
                  {signal.value.toLocaleString()} {signal.label}
                </MicroLabel>
              </div>
              {active.pinnedAt ? (
                <Text size="xs" variant="muted">
                  Pinned {timeAgo(active.pinnedAt)}
                </Text>
              ) : null}
            </div>
            {active.action}
          </motion.div>
        </AnimatePresence>
      </div>
    </Well>
  );
}

/** Every field the row reads, so a pin whose jam has left the board still
 *  renders from its own stored summary. */
type RowJam = Pick<
  JamFromList,
  | "jamId"
  | "slug"
  | "title"
  | "hosts"
  | "startsAt"
  | "endsAt"
  | "votingEndsAt"
  | "joinedCount"
  | "entriesCount"
>;

function JamRow({
  jam,
  now,
  status,
  pinnedAt,
  muted = false,
  action,
}: {
  jam: RowJam;
  now: Date;
  status?: RowStatus;
  pinnedAt?: Date | string | null;
  muted?: boolean;
  action?: React.ReactNode;
}) {
  const start = jamMonthDay(jam.startsAt);
  const end = jamMonthDay(jam.endsAt);
  const signal = jamSignal(jam, now);

  return (
    <AdminRow muted={muted}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <RouterLink
            to="/jams/$jamSlug"
            params={jamLinkParams(jam)}
            className="min-w-0 text-sm font-medium hover:text-primary hover:underline"
          >
            {jam.title}
          </RouterLink>
          <div className="flex flex-wrap items-center gap-2">
            {status ? (
              <Badge size="label" variant={status.tone}>
                {status.label}
              </Badge>
            ) : null}
            <MicroLabel as="span" className="text-muted-foreground">
              {hostName(jam)}
            </MicroLabel>
            <MicroLabel as="span" className="text-muted-foreground">
              {start.month} {start.day}
              {jam.endsAt ? ` → ${end.month} ${end.day}` : ""}
            </MicroLabel>
            <MicroLabel as="span" className="text-muted-foreground">
              {signal.value.toLocaleString()} {signal.label}
            </MicroLabel>
          </div>
          {pinnedAt ? (
            <Text size="xs" variant="muted">
              Pinned {timeAgo(pinnedAt)}
            </Text>
          ) : null}
        </div>
        {action}
      </div>
    </AdminRow>
  );
}

function PinButton({
  pinned,
  busy,
  onClick,
}: {
  pinned: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={pinned ? "outline" : "default"}
      disabled={busy}
      onClick={onClick}
      className="tracking-widest"
    >
      <HugeiconsIcon
        icon={pinned ? PinOffIcon : PinIcon}
        strokeWidth={2}
        data-icon="inline-start"
      />
      {pinned ? "UNPIN" : "PIN"}
    </Button>
  );
}

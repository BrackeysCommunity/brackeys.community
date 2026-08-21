import { Alert02Icon, PinIcon, PinOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AdminEmpty, AdminRow, AdminSection, Field, errText } from "@/components/admin/AdminUI";
import { heroJamDisplacedByPin, heroPinApplies } from "@/components/home/hero-jam";
import {
  type JamFromList,
  jamMatchesSearch,
  jamShelf,
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
import useDateNow from "@/lib/hooks/use-date-now";
import { hostName, jamLinkParams, jamMonthDay } from "@/lib/jam-links";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

/** Enough hits to find the jam you had in mind, not a second jam board. */
const SEARCH_LIMIT = 8;

/**
 * Staff curation for the home hero. The rules live in `pickHeroJam`; this
 * panel shows what holds the slot now, what is queued, and what aged out.
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
  const hero = useMemo(() => homeJamsFrom(jams, now, pins).hero, [jams, now, pins]);

  const byId = useMemo(() => new Map(jams.map((jam) => [jam.jamId, jam])), [jams]);
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.jamId)), [pins]);
  const displaced = useMemo(
    () => heroJamDisplacedByPin(hero, jams, nowDate),
    [hero, jams, nowDate],
  );

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
    onError: (err: unknown) => toast.error(errText(err)),
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

  return (
    <div className="flex flex-col gap-8">
      <AdminSection
        title="Home hero"
        hint="The jam the landing page leads with right now. A pin outranks everything else, including a Brackeys jam."
      >
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : !hero ? (
          <AdminEmpty>Nothing is live or upcoming, so the hero has no jam to show.</AdminEmpty>
        ) : (
          <>
            {displaced ? <DisplacedNotice jam={displaced} now={nowDate} /> : null}
            <JamRow
              jam={hero.jam}
              now={nowDate}
              status={HERO_SOURCE[hero.source]}
              pinnedAt={pins.find((p) => p.jamId === hero.jam.jamId)?.pinnedAt ?? null}
              action={
                hero.source === "pinned" ? (
                  <PinButton
                    pinned
                    busy={toggle.isPending}
                    onClick={() => toggle.mutate({ jamId: hero.jam.jamId, pinned: false })}
                  />
                ) : hero.source === "ranked" ? (
                  <PinButton
                    pinned={false}
                    busy={toggle.isPending}
                    onClick={() => toggle.mutate({ jamId: hero.jam.jamId, pinned: true })}
                  />
                ) : null
              }
            />
          </>
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
              const leading = hero?.jam.jamId === pin.jamId;
              return (
                <JamRow
                  key={pin.jamId}
                  jam={jam ?? pin}
                  now={nowDate}
                  muted={!applies}
                  pinnedAt={pin.pinnedAt}
                  status={
                    leading
                      ? { label: "LEADING", tone: "default" }
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

/** The Brackeys jam a pin is outranking — a receipt, not a block: the pin
 * still wins, but nobody should discover the displacement from the front page. */
function DisplacedNotice({ jam, now }: { jam: JamFromList; now: Date }) {
  const live = jamShelf(jam, now) === "live";

  return (
    <Well variant="ghost" className="border-warning/40 p-3">
      <div className="flex items-start gap-2.5">
        <HugeiconsIcon
          icon={Alert02Icon}
          size={16}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-warning"
        />
        <Text size="xs">
          <Text as="span" size="xs" bold>
            {jam.title}
          </Text>{" "}
          is {live ? "live right now" : "coming up"} and the pin above is keeping it off the home
          page. Unpin to hand the hero back to it.
        </Text>
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

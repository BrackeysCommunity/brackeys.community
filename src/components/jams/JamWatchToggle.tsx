import { CheckmarkCircle02Icon, EyeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { Button } from "@/components/ui/button";
import { authStore } from "@/lib/auth-store";
import { toastMutationError } from "@/lib/mutation-errors";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import type { JamPhase } from "./JamCalendarPage/helpers";

/**
 * The only user-declared thing about a jam: watching it, and — for guild
 * members on a jam that hasn't ended — the stronger "entering".
 *
 * Two buttons rather than a three-state cycle. A cycling control makes the
 * common case (drop a jam you no longer care about) take two clicks through
 * a state you didn't want, and hides "entering" from anyone who doesn't
 * think to keep clicking.
 *
 * Icon-only, because these are standing toggles sitting beside the jam's
 * real calls to action and shouldn't compete with them for width. The icon
 * names the thing, the lit variant carries the state, and the label lives in
 * the tooltip and `aria-label` — which is also where the wording that only
 * matters once you're deciding ("you'll still watch it") belongs.
 *
 * Declaring is gated server-side on guild membership; this renders the
 * button regardless and lets the refusal explain itself, because hiding it
 * would leave a non-member wondering why other people's jams show a count
 * they can't contribute to.
 */
export function JamWatchToggle({
  jamId,
  phase,
  className,
}: {
  jamId: number;
  phase: JamPhase;
  className?: string;
}) {
  const { session } = useStore(authStore);
  const signedIn = session?.user != null;
  const queryClient = useQueryClient();

  const { data } = useQuery({
    ...orpc.getJamViewerState.queryOptions({ input: { jamId } }),
    enabled: signedIn,
    staleTime: STALE.listing,
  });
  const intent = data?.intent ?? null;

  const set = useMutation({
    mutationFn: (next: "watching" | "entering" | null) =>
      client.setJamWatch({ jamId, intent: next }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.getJamViewerState.queryOptions({ input: { jamId } }).queryKey,
        }),
        // The declared-members tier and its count both move.
        queryClient.invalidateQueries({
          queryKey: orpc.getJamCommunity.queryOptions({ input: { jamId } }).queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: ["listMyJamWatches"] }),
      ]);
    },
    onError: toastMutationError("jam.watch_toggle"),
  });

  if (!signedIn) return null;

  // Declaring intent for a jam that already ended says nothing — itch is the
  // source of truth for who actually shipped. Watching still makes sense
  // during voting (results are a phase change worth being told about).
  const canDeclare = phase === "upcoming" || phase === "running";
  const watching = intent != null;
  const entering = intent === "entering";

  const watchLabel = watching ? "Stop watching this jam" : "Watch this jam";
  const enterLabel = entering
    ? "Stop showing yourself as entering (you'll still watch it)"
    : "Show up on this jam's page as entering";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        size="icon-sm"
        variant={watching ? "secondary" : "outline"}
        onClick={() => set.mutate(watching ? null : "watching")}
        disabled={set.isPending}
        aria-pressed={watching}
        aria-label={watchLabel}
        tooltip={watchLabel}
      >
        {/* The eye stays an eye whether or not you're watching: on an
            icon-only toggle the crossed-out variant reads as the current
            state ("hidden") rather than as what a click would do. */}
        <HugeiconsIcon icon={EyeIcon} size={14} />
      </Button>

      {canDeclare ? (
        <Button
          size="icon-sm"
          variant={entering ? "secondary" : "outline"}
          onClick={() => set.mutate(entering ? "watching" : "entering")}
          disabled={set.isPending}
          aria-pressed={entering}
          aria-label={enterLabel}
          tooltip={enterLabel}
        >
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
        </Button>
      ) : null}
    </div>
  );
}

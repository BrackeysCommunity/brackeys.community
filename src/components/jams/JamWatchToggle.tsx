import { CheckmarkCircle02Icon, EyeIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

import type { JamPhase } from "./JamCalendarPage/helpers";

/**
 * The only user-declared thing about a jam: WATCH, and — for guild members
 * on a jam that hasn't ended — the stronger "I'M ENTERING".
 *
 * Two buttons rather than a three-state cycle. A cycling control makes the
 * common case (drop a jam you no longer care about) take two clicks through
 * a state you didn't want, and hides "entering" from anyone who doesn't
 * think to keep clicking.
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
    staleTime: 60 * 1000,
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
    onError: (err: Error) => toast.error(err.message),
  });

  if (!signedIn) return null;

  // Declaring intent for a jam that already ended says nothing — itch is the
  // source of truth for who actually shipped. Watching still makes sense
  // during voting (results are a phase change worth being told about).
  const canDeclare = phase === "upcoming" || phase === "running";
  const watching = intent != null;
  const entering = intent === "entering";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        size="sm"
        variant={watching ? "secondary" : "outline"}
        onClick={() => set.mutate(watching ? null : "watching")}
        disabled={set.isPending}
        className="tracking-widest"
      >
        <HugeiconsIcon icon={watching ? ViewOffSlashIcon : EyeIcon} size={12} />
        {watching ? "UNWATCH" : "WATCH"}
      </Button>

      {canDeclare ? (
        <Button
          size="sm"
          variant={entering ? "secondary" : "outline"}
          onClick={() => set.mutate(entering ? "watching" : "entering")}
          disabled={set.isPending}
          className="tracking-widest"
          title={
            entering
              ? "Stop showing yourself as entering (you'll still watch it)"
              : "Show up on this jam's page as entering"
          }
        >
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
          {entering ? "ENTERING" : "I'M ENTERING"}
        </Button>
      ) : null}
    </div>
  );
}

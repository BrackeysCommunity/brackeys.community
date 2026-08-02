import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { client } from "@/orpc/client";

import type { ProfileItchSync } from "./helpers";

interface ProfileSyncBarProps {
  itch: ProfileItchSync | null;
  isOwner: boolean;
  /** `getProfile` query key — invalidated after a resync so freshly
   * imported games appear without a reload. */
  queryKey?: readonly unknown[];
}

/**
 * Full-width itch.io strip under the hero — monogram tile, linked
 * account identity, imported-game count, and a RESYNC button that
 * re-runs the itch.io library import. Owner-only sync chrome:
 * visitors just see the imported games themselves in SHIPPED WORK
 * (plus the itch.io row in LINKED), so the bar renders nothing on
 * profiles the viewer doesn't own — and likewise when no itch.io
 * account is linked.
 */
export function ProfileSyncBar({ itch, isOwner, queryKey }: ProfileSyncBarProps) {
  const qc = useQueryClient();
  const resync = useMutation({
    mutationFn: () => client.importItchIoGames({}),
    onSuccess: (result) => {
      if (queryKey) void qc.invalidateQueries({ queryKey });
      toast.success(
        result.imported > 0
          ? `Imported ${result.imported} new game${result.imported === 1 ? "" : "s"} from itch.io`
          : "itch.io library is up to date",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to sync itch.io"),
  });

  if (!itch || !isOwner) return null;

  return (
    <Well className="flex-row flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <Chonk
        variant="surface"
        size="lg"
        className="flex h-11 w-11 shrink-0 items-center justify-center font-mono text-sm font-bold tracking-widest text-destructive"
      >
        IT
      </Chonk>

      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
        <Text bold size="sm">
          itch.io
        </Text>
        {itch.url ? (
          <a
            href={itch.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate font-mono text-xs tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            {itch.display}
          </a>
        ) : (
          <Text size="xs" variant="muted" className="truncate tracking-wider">
            {itch.display}
          </Text>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end leading-tight">
        <Text bold density="dense" className="text-2xl tabular-nums">
          {itch.gamesCount}
        </Text>
        <Text size="xs" variant="muted" className="tracking-widest">
          GAMES
        </Text>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => resync.mutate()}
        disabled={resync.isPending}
        className="shrink-0"
      >
        <HugeiconsIcon icon={RefreshIcon} size={14} />
        <span className="font-mono tracking-widest">
          {resync.isPending ? "SYNCING…" : "RESYNC"}
        </span>
      </Button>
    </Well>
  );
}

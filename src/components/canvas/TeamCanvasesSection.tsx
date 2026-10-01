import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";

import { canvasListQueryOptions } from "./canvas-queries";
import { CanvasCardLink } from "./CanvasCardLink";
import { NewCanvasDialog } from "./NewCanvasDialog";
import { openWorkspace } from "./workspace-store";

/** The team page's CANVASES & NOTES buttons, for its section header. */
export function TeamCanvasesActions({ teamId, canCreate }: { teamId: string; canCreate: boolean }) {
  const [creating, setCreating] = useState(false);
  return (
    <span className="flex items-center gap-1.5">
      <Button size="xs" variant="ghost" onClick={() => openWorkspace(teamId)}>
        Open workspace
      </Button>
      {canCreate ? (
        <Button size="xs" variant="outline" onClick={() => setCreating(true)}>
          <HugeiconsIcon icon={Add01Icon} size={12} />
          New canvas
        </Button>
      ) : null}
      {creating ? (
        <NewCanvasDialog open onClose={() => setCreating(false)} scope={{ kind: "team", teamId }} />
      ) : null}
    </span>
  );
}

/** The team's three most recently edited canvases, for its members. */
export function TeamCanvasesSection({ teamId }: { teamId: string }) {
  const scope = { kind: "team" as const, teamId };
  const { data, isPending } = useQuery(
    canvasListQueryOptions(scope, { thumbnails: true, limit: 3, orderBy: "edited" }),
  );

  if (isPending) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="aspect-[16/12] w-full rounded-lg" />
      </div>
    );
  }
  if (!data?.length) {
    return (
      <Text as="p" size="xs" variant="muted">
        Plan the next jam together: a canvas here is shared with the whole roster.
      </Text>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((canvas) => (
          <CanvasCardLink key={canvas.id} canvas={canvas} />
        ))}
      </div>
      <Link
        to="/canvases"
        search={{ scope: teamId }}
        className="self-start text-xs text-primary hover:underline"
      >
        All of the team's canvases
      </Link>
    </div>
  );
}

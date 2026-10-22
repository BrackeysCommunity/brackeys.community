import { Link } from "@tanstack/react-router";

import { TimeAgo } from "@/components/ui/time-ago";
import { Text } from "@/components/ui/typography";
import { dirname } from "@/lib/canvas/paths";

import type { CanvasListItem } from "./canvas-queries";
import { CanvasThumbnail } from "./CanvasThumbnail";

type CanvasCard = Pick<CanvasListItem, "id" | "path" | "title" | "thumbnail"> & {
  lastEditedAt?: CanvasListItem["lastEditedAt"];
};

/**
 * A canvas as a thumbnail card, for listings. `detail` replaces the folder
 * and last-edit line, for lists that know something more useful.
 */
export function CanvasCardLink({
  canvas,
  detail,
}: {
  canvas: CanvasCard;
  detail?: React.ReactNode;
}) {
  const folder = dirname(canvas.path);
  return (
    <Link
      to="/canvases/$canvasId"
      params={{ canvasId: canvas.id }}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/60"
    >
      <CanvasThumbnail thumbnail={canvas.thumbnail} className="aspect-[16/10] w-full" />
      <div className="flex flex-col gap-0.5 border-t border-border px-3 py-2">
        <Text as="span" size="sm" bold ellipsis>
          {canvas.title}
        </Text>
        <Text as="span" size="xs" variant="muted" ellipsis>
          {detail ?? (
            <>
              {folder ? `${folder} · ` : ""}
              {canvas.lastEditedAt ? <TimeAgo date={canvas.lastEditedAt} /> : "Not edited yet"}
            </>
          )}
        </Text>
      </div>
    </Link>
  );
}

import { Link } from "@tanstack/react-router";

import { TimeAgo } from "@/components/ui/time-ago";
import { Text } from "@/components/ui/typography";
import { dirname } from "@/lib/canvas/paths";

import type { CanvasListItem } from "./canvas-queries";
import { CanvasThumbnail } from "./CanvasThumbnail";

/** A canvas as a thumbnail card, for listings. */
export function CanvasCardLink({ canvas }: { canvas: CanvasListItem }) {
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
          {folder ? `${folder} · ` : ""}
          {canvas.lastEditedAt ? <TimeAgo date={canvas.lastEditedAt} /> : "Not edited yet"}
        </Text>
      </div>
    </Link>
  );
}

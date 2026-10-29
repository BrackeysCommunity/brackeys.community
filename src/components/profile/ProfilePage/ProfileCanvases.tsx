import { useQuery } from "@tanstack/react-query";

import { publicCanvasesQueryOptions } from "@/components/canvas/canvas-queries";
import { CanvasCardLink } from "@/components/canvas/CanvasCardLink";
import { useCanvasesOn } from "@/components/canvas/use-canvases-on";

import { ProfileSectionHeader } from "./ProfileSectionHeader";

/**
 * `§N CANVASES` — the member's public canvases. Renders nothing when there
 * are none, like the teams section: most profiles won't have any.
 */
export function ProfileCanvasesSection({
  index,
  profileId,
  stacked = false,
}: {
  index: string;
  profileId: string;
  /** One card per row, for the profile's narrow side column. */
  stacked?: boolean;
}) {
  const canvasesOn = useCanvasesOn();
  const { data: canvases } = useQuery({
    ...publicCanvasesQueryOptions({ ownerId: profileId }),
    enabled: canvasesOn,
  });

  if (!canvasesOn || !canvases || canvases.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader index={index} title="CANVASES" />
      <div
        className={
          stacked ? "flex flex-col gap-3" : "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        }
      >
        {canvases.map((canvas) => (
          <CanvasCardLink key={canvas.id} canvas={canvas} />
        ))}
      </div>
    </section>
  );
}

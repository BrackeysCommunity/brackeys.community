import { AdminFeatured } from "@/components/admin/AdminFeatured";
import { AdminHeroJam } from "@/components/admin/AdminHeroJam";
import { type SpotlightPane, SPOTLIGHT_PANES } from "@/components/admin/panes";
import { UnderlineTabs } from "@/components/ui/underline-tabs";

export { SPOTLIGHT_PANES, type SpotlightPane };

const TABS = [
  { key: "featured", label: "BOARD FEATURED" },
  { key: "hero", label: "HOME HERO" },
] as const;

/**
 * The two "what leads" surfaces in one section: the pinned posts at the
 * top of the board, and the jam rotation the landing page opens with.
 * Neither is moderation and both are curation, which is why they share a
 * rail entry.
 */
export function AdminSpotlight({
  pane,
  onPane,
}: {
  pane: SpotlightPane;
  onPane: (next: SpotlightPane) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <UnderlineTabs tabs={TABS} active={pane} onSelect={onPane} label="Spotlight surfaces" />
      {pane === "featured" ? <AdminFeatured /> : <AdminHeroJam />}
    </div>
  );
}

import { CubeIcon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-store";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { collabStore, setCollabFilters } from "@/lib/collab-store";

/**
 * Projects ↔ People segmented control. Shared between mobile (above
 * the feed) and the filter panel.
 */
export function CollabListingToggle({
  priority = "primary",
}: {
  priority?: "default" | "primary";
}) {
  const { filters } = useStore(collabStore);
  const value = filters.listingType === "people" ? "people" : "posts";
  return (
    <SegmentedControl
      value={value}
      onChange={(v) => setCollabFilters({ listingType: v as "posts" | "people" })}
      size="md"
      priority={priority}
      className="w-full [&>[data-slot=segmented-control-item]]:flex-1"
    >
      <SegmentedControl.Item value="posts" icon={<HugeiconsIcon icon={CubeIcon} />}>
        PROJECTS
      </SegmentedControl.Item>
      <SegmentedControl.Item value="people" icon={<HugeiconsIcon icon={UserGroupIcon} />}>
        PEOPLE
      </SegmentedControl.Item>
    </SegmentedControl>
  );
}

import { useState } from "react";

import { EVENTS, FLOWS, flowStep } from "@/lib/event-taxonomy";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { captureEvent } from "@/lib/product-insights";

import type { ProfileViewModel } from "./helpers";
import { ProfileDesktop } from "./ProfileDesktop";
import { ProfileEditFlyout } from "./ProfileEditFlyout";
import { ProfileMobile } from "./ProfileMobile";
import {
  EDIT_STEP_COUNT,
  EDIT_STEP_SLUGS,
  type EditStep,
  type ProfileLayoutProps,
} from "./shared-types";

interface ProfilePageProps {
  profile: ProfileViewModel;
  isOwner: boolean;
  /** TanStack Query cache key for the underlying `getProfile` fetch
   * — threaded into the edit flyout so mutations can invalidate.
   * Optional so static / preview surfaces (sample data) can render
   * the page without a real query. */
  queryKey?: readonly unknown[];
}

/**
 * Owns the page-level state (currently just the edit-flyout open
 * state + active step) and forwards a typed bundle to one of two
 * presentational layouts. Mirrors the `JamCalendarPage` orchestrator
 * shape so future phases (edit flyout, real data wiring) plug in
 * without restructuring.
 */
export function ProfilePage({ profile, isOwner, queryKey }: ProfilePageProps) {
  const isMobile = useIsMobile();
  const [edit, setEdit] = useState<{ open: boolean; step: EditStep }>({
    open: false,
    step: 1,
  });

  const stepProps = (step: EditStep) =>
    flowStep(FLOWS.profileEdit, EDIT_STEP_SLUGS[step], step, EDIT_STEP_COUNT);

  const layoutProps: ProfileLayoutProps = {
    profile,
    isOwner,
    edit,
    openEdit: (step) => {
      // `step` is the entry point, not always 1 — a section's own "edit"
      // button deep-links into the step that owns it, and a funnel that
      // assumed everyone starts at `identity` would read as mass drop-off
      // on step 1.
      captureEvent(EVENTS.profileEditStarted, stepProps(step));
      setEdit({ open: true, step });
    },
    closeEdit: () => setEdit((prev) => ({ ...prev, open: false })),
    queryKey,
  };

  const handleStepChange = (next: EditStep) => {
    // Forward moves only. Stepping back is navigation, not progress, and
    // counting it would let one person advance the same step repeatedly.
    if (next > edit.step) captureEvent(EVENTS.profileEditStepAdvanced, stepProps(edit.step));
    setEdit({ open: true, step: next });
  };

  return (
    <>
      {isMobile ? <ProfileMobile {...layoutProps} /> : <ProfileDesktop {...layoutProps} />}
      {isOwner ? (
        <ProfileEditFlyout
          open={edit.open}
          step={edit.step}
          profile={profile}
          queryKey={queryKey}
          onClose={layoutProps.closeEdit}
          onStepChange={handleStepChange}
        />
      ) : null}
    </>
  );
}

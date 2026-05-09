import { useState } from "react";

import { useIsTouchDevice } from "@/hooks/use-touch-device";

import type { ProfileViewModel } from "./helpers";
import { ProfileDesktop } from "./ProfileDesktop";
import { ProfileEditFlyout } from "./ProfileEditFlyout";
import { ProfileMobile } from "./ProfileMobile";
import type { EditStep, ProfileLayoutProps } from "./shared-types";

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
  const isTouch = useIsTouchDevice();
  const [edit, setEdit] = useState<{ open: boolean; step: EditStep }>({
    open: false,
    step: 1,
  });

  const layoutProps: ProfileLayoutProps = {
    profile,
    isOwner,
    edit,
    openEdit: (step) => setEdit({ open: true, step }),
    closeEdit: () => setEdit((prev) => ({ ...prev, open: false })),
    queryKey,
  };

  return (
    <>
      {isTouch ? <ProfileMobile {...layoutProps} /> : <ProfileDesktop {...layoutProps} />}
      {isOwner ? (
        <ProfileEditFlyout
          open={edit.open}
          step={edit.step}
          profile={profile}
          queryKey={queryKey}
          onClose={layoutProps.closeEdit}
          onStepChange={(step) => setEdit({ open: true, step })}
        />
      ) : null}
    </>
  );
}

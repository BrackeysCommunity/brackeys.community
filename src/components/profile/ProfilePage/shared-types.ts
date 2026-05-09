import type { ProfileViewModel } from "./helpers";

export type EditStep = 1 | 2 | 3 | 4;

export interface ProfileLayoutProps {
  profile: ProfileViewModel;
  /** True when the viewer is the profile owner — controls "EDIT
   * PROFILE" CTAs and per-section edit affordances. */
  isOwner: boolean;
  /** Edit-mode state. `step` is which stepper page the flyout is on;
   * "edit" buttons on a section pre-select its corresponding step. */
  edit: { open: boolean; step: EditStep };
  openEdit: (step: EditStep) => void;
  closeEdit: () => void;
  /** TanStack Query key for the underlying `getProfile` fetch — used
   * by inline mutations (project add/edit/remove) to invalidate the
   * page after a change. */
  queryKey?: readonly unknown[];
}

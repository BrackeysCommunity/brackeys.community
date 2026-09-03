import { useStore } from "@tanstack/react-store";
import { useState } from "react";

import { CollabQuickPostForm } from "@/components/collab/CollabQuickPost/CollabQuickPostForm";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { authStore } from "@/lib/auth-store";
import { collabStore } from "@/lib/collab-store";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { useReleaseFocusOnOpen } from "@/lib/hooks/use-release-focus";

import { CollabCreateForm } from "./CollabCreateForm";
import { CollabCreateUnauth } from "./CollabCreateUnauth";

/** Which create surface the drawer opens on. Edits always use the wizard. */
export type CollabCreateSurface = "quick" | "wizard";

export interface CollabCreateFlyoutProps {
  open: boolean;
  onClose: () => void;
  /** Called with the post id once the create/update mutation resolves. */
  onCreated?: (postId: number) => void;
  /** The create surface: the one-screen post by default, the five-step
   *  wizard behind the `?flow=wizard` hatch. */
  surface?: CollabCreateSurface;
}

/**
 * The create wizard, on the same drawer primitive as the post detail
 * and the filter panel — bottom sheet on touch, right-side panel on
 * desktop. The drawer owns dismissal (swipe, scrim, Esc), so the panel
 * carries no close button of its own; the draft is auto-saved, so
 * dismissing never costs work.
 */
export function CollabCreateFlyout({
  open,
  onClose,
  onCreated,
  surface = "quick",
}: CollabCreateFlyoutProps) {
  const { session, isPending } = useStore(authStore);
  const isMobile = useIsMobile();
  useReleaseFocusOnOpen(open);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && onClose()}
      direction={isMobile ? "bottom" : "right"}
    >
      <DrawerContent
        className="p-0 sm:max-w-[32rem]"
        // A fixed tall sheet on touch so stepping through the wizard
        // doesn't resize the drawer under the user's thumb.
        style={isMobile ? { height: "88vh", maxHeight: "88vh" } : undefined}
      >
        {/* The panel renders its own visible heading; these name and
            describe the dialog for assistive tech. */}
        <DrawerTitle className="sr-only">Post a gig</DrawerTitle>
        <DrawerDescription className="sr-only">
          Create a collaboration post: paid work or a hobby project.
        </DrawerDescription>

        {isPending ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <span className="animate-pulse text-xs tracking-widest text-muted-foreground uppercase">
              Authenticating…
            </span>
          </div>
        ) : !session?.user ? (
          <CollabCreateUnauth />
        ) : (
          /* Keyed on `open` so each opening mounts a fresh form — that's
             what re-runs the draft restore and re-seeds an edit. */
          <CollabCreateBody
            key={open ? "open" : "closed"}
            surface={surface}
            onCreated={(id) => {
              onCreated?.(id);
              onClose();
            }}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The quick screen for a new post, the wizard for an edit or when asked.
 * The quick screen's own FULL FORM control flips to the wizard for this
 * opening only — the draft is shared, so nothing typed is lost.
 */
function CollabCreateBody({
  surface,
  onCreated,
}: {
  surface: CollabCreateSurface;
  onCreated: (postId: number) => void;
}) {
  const editing = useStore(collabStore, (s) => s.wizard.editingPostId !== null);
  const [wizardRequested, setWizardRequested] = useState(false);
  if (editing || surface === "wizard" || wizardRequested) {
    return <CollabCreateForm onCreated={onCreated} />;
  }
  return (
    <CollabQuickPostForm onCreated={onCreated} onSwitchToWizard={() => setWizardRequested(true)} />
  );
}

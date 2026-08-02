import { useStore } from "@tanstack/react-store";

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useIsTouchDevice } from "@/hooks/use-touch-device";
import { authStore } from "@/lib/auth-store";

import { useReleaseFocusOnOpen } from "../use-release-focus";
import { CollabCreateForm } from "./CollabCreateForm";
import { CollabCreateUnauth } from "./CollabCreateUnauth";

export interface CollabCreateFlyoutProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new post id once the create mutation resolves. */
  onCreated?: (postId: number) => void;
}

/**
 * The create wizard, on the same drawer primitive as the post detail
 * and the filter panel — bottom sheet on touch, right-side panel on
 * desktop. The drawer owns dismissal (swipe, scrim, Esc), so the panel
 * carries no close button of its own; the draft is auto-saved, so
 * dismissing never costs work.
 */
export function CollabCreateFlyout({ open, onClose, onCreated }: CollabCreateFlyoutProps) {
  const { session, isPending } = useStore(authStore);
  const isTouch = useIsTouchDevice();
  useReleaseFocusOnOpen(open);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && onClose()}
      direction={isTouch ? "bottom" : "right"}
    >
      <DrawerContent
        className="p-0 sm:max-w-[32rem]"
        // A fixed tall sheet on touch so stepping through the wizard
        // doesn't resize the drawer under the user's thumb.
        style={isTouch ? { height: "88vh", maxHeight: "88vh" } : undefined}
      >
        {/* The panel renders its own visible heading; these name and
            describe the dialog for assistive tech. */}
        <DrawerTitle className="sr-only">Post a gig</DrawerTitle>
        <DrawerDescription className="sr-only">
          Create a collaboration post: paid work, hobby project, playtest, or mentorship.
        </DrawerDescription>

        {isPending ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <span className="animate-pulse font-mono text-xs tracking-widest text-muted-foreground uppercase">
              Authenticating…
            </span>
          </div>
        ) : !session?.user ? (
          <CollabCreateUnauth />
        ) : (
          <CollabCreateForm
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

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useReleaseFocusOnOpen } from "@/hooks/use-release-focus";

import { CollabPostDetail } from "./CollabPostDetail";

interface CollabPostPopoverProps {
  /** Numeric post id to show; the drawer is closed when `null`. */
  postId: number | null;
  /** Currently signed-in user id, or null when anonymous. */
  currentUserId: string | null;
  onClose: () => void;
  /** Opens the create flyout in edit mode for the owner's own post. */
  onEdit?: () => void;
}

/**
 * Narrow-viewport detail surface: a bottom drawer. On desktop the same
 * `CollabPostDetail` renders in the inspector pane instead — this exists
 * only where there isn't room for two panes, so the board is never a
 * dead end on mobile.
 *
 * Deliberately not a shared-layout morph from the tapped card: on a
 * phone the card is most of the screen, so the expand animation read as
 * the page lurching rather than as a transition. A drawer slides from
 * the edge and leaves the list visibly behind it.
 */
export function CollabPostPopover({
  postId,
  currentUserId,
  onClose,
  onEdit,
}: CollabPostPopoverProps) {
  const isOpen = postId !== null;
  useReleaseFocusOnOpen(isOpen);

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[88vh] p-0">
        {/* The detail renders its own heading; these exist so the dialog
            has an accessible name and description. */}
        <DrawerTitle className="sr-only">Post detail</DrawerTitle>
        <DrawerDescription className="sr-only">
          Full details for the selected collaboration post.
        </DrawerDescription>
        {/* Top padding clears the drag handle the drawer draws above. */}
        <div className="flex min-h-0 flex-1 flex-col pt-3 pb-[env(safe-area-inset-bottom)]">
          {postId !== null ? (
            <CollabPostDetail
              postId={postId}
              currentUserId={currentUserId}
              onClose={onClose}
              onEdit={onEdit}
              showClose={false}
              frameless
            />
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

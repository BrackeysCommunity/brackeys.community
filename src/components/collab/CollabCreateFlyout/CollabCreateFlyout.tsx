import { useStore } from "@tanstack/react-store";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { useIsTouchDevice } from "@/hooks/use-touch-device";
import { authStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

import { CollabCreateForm } from "./CollabCreateForm";
import { CollabCreateUnauth } from "./CollabCreateUnauth";

const DESKTOP_TRANSITION = { type: "spring" as const, stiffness: 480, damping: 36, mass: 0.7 };
const MOBILE_TRANSITION = { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.65 };

export interface CollabCreateFlyoutProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new post id once the create mutation resolves. */
  onCreated?: (postId: number) => void;
}

/**
 * Slide-over create flyout — right-side panel on desktop, bottom sheet
 * on touch. Mirrors the profile edit flyout's animation language so
 * the two flows feel like part of the same system.
 */
export function CollabCreateFlyout({ open, onClose, onCreated }: CollabCreateFlyoutProps) {
  const { session, isPending } = useStore(authStore);
  const isTouch = useIsTouchDevice();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
            style={{ touchAction: "none" }}
          />
          <motion.div
            key="panel"
            initial={isTouch ? { y: "100%" } : { x: "100%" }}
            animate={isTouch ? { y: 0 } : { x: 0 }}
            exit={isTouch ? { y: "100%" } : { x: "100%" }}
            transition={isTouch ? MOBILE_TRANSITION : DESKTOP_TRANSITION}
            className={cn(
              "fixed z-50 flex flex-col border-muted/30 bg-background shadow-[0_0_60px_0_rgba(0,0,0,0.4)]",
              isTouch
                ? "inset-x-0 bottom-0 h-[88vh] rounded-t-xl border-t"
                : "inset-y-0 right-0 w-[32rem] max-w-[100vw] border-l",
            )}
          >
            {isPending ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <span className="animate-pulse font-mono text-xs tracking-widest text-muted-foreground uppercase">
                  Authenticating…
                </span>
              </div>
            ) : !session?.user ? (
              <CollabCreateUnauth isTouch={isTouch} onClose={onClose} />
            ) : (
              <CollabCreateForm
                isTouch={isTouch}
                onClose={onClose}
                onCreated={(id) => {
                  onCreated?.(id);
                  onClose();
                }}
              />
            )}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

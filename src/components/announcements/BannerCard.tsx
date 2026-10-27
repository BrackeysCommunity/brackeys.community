import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";

import { BANNER_ART, type BannerArtKey } from "@/components/announcements/banner-art";
import { SPOTLIGHT_KEEP_ATTR } from "@/components/announcements/spotlight";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The floating surface every banner kind sits on. */
export function BannerCard({
  label,
  art,
  onDismiss,
  className,
  children,
}: {
  label: string;
  /** Hangs off the top edge, left of the dismiss button; give the heading `pr-24` to clear it. */
  art?: BannerArtKey;
  onDismiss: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const Art = art ? BANNER_ART[art] : null;

  return (
    <motion.aside
      aria-label={label}
      {...{ [SPOTLIGHT_KEEP_ATTR]: "" }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "pointer-events-auto relative flex w-full max-w-sm flex-col gap-3 rounded-lg border border-border bg-card p-4 pr-10 shadow-lg",
        Art && "mt-12",
        className,
      )}
    >
      {Art ? (
        <motion.div
          className="pointer-events-none absolute -top-12 right-10 size-24 drop-shadow-lg"
          initial={{ rotate: -24, scale: 0.6, y: 12 }}
          animate={{ rotate: 10, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}
        >
          <Art />
        </motion.div>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        tooltip="Dismiss"
        className="absolute top-2 right-2"
        onClick={onDismiss}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} />
      </Button>
      {children}
    </motion.aside>
  );
}

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";

import { SPOTLIGHT_KEEP_ATTR } from "@/components/announcements/spotlight";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The floating surface every banner kind sits on. */
export function BannerCard({
  label,
  onDismiss,
  className,
  children,
}: {
  label: string;
  onDismiss: () => void;
  className?: string;
  children: React.ReactNode;
}) {
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
        className,
      )}
    >
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

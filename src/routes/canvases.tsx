import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { Button } from "@/components/ui/button";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { useFlagBlocks } from "@/lib/hooks/use-flag";
import { useIsMobile } from "@/lib/hooks/use-mobile";

/**
 * Every `/canvases/*` page sits behind `canvases-enabled`. The procedures
 * are the real gate (NOT_FOUND while it's off); this covers a flag turned
 * off mid-visit. Phones get a pointer to desktop until the editor works there.
 */
export const Route = createFileRoute("/canvases")({
  component: CanvasesLayout,
});

function CanvasesLayout() {
  const isMobile = useIsMobile();
  if (useFlagBlocks("canvases-enabled")) return <NotFoundPage />;
  if (isMobile) return <CanvasesDesktopOnly />;
  return <Outlet />;
}

function CanvasesDesktopOnly() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 py-8">
      <MicroLabel as="p" className="uppercase">
        Canvases
      </MicroLabel>
      <Heading as="h1" size="3xl" display>
        Open this on a computer
      </Heading>
      <Text as="p" variant="muted" textWrap="pretty">
        Canvases don't work on phones yet. Open this link on a desktop or laptop, or in a wider
        window, to see it.
      </Text>
      <div>
        <Button
          variant="default"
          className="mt-3 tracking-widest"
          nativeButton={false}
          render={<Link to="/" />}
        >
          HOME
        </Button>
      </div>
    </div>
  );
}

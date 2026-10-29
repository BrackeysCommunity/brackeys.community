import { useFlag } from "@/lib/hooks/use-flag";
import { useIsMobile } from "@/lib/hooks/use-mobile";

/** Canvases are desktop-only until the editor works on phones. */
export function useCanvasesOn(): boolean {
  const flagOn = useFlag("canvases-enabled");
  const isMobile = useIsMobile();
  return flagOn && !isMobile;
}

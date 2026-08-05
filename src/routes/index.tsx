import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/components/home/HomePage";
import { MobileHome } from "@/components/home/MobileHome";
import { useIsMobile } from "@/hooks/use-mobile";

function HomeRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileHome /> : <HomePage />;
}

export const Route = createFileRoute("/")({ component: HomeRoute });

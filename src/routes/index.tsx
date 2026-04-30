import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/components/home/HomePage";
import { MobileHome } from "@/components/home/MobileHome";
import { useIsTouchDevice } from "@/hooks/use-touch-device";

function HomeRoute() {
  const isTouch = useIsTouchDevice();
  return isTouch ? <MobileHome /> : <HomePage />;
}

export const Route = createFileRoute("/")({ component: HomeRoute });

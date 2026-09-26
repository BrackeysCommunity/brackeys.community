import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

export function arcadeAccessQueryOptions() {
  return { ...orpc.getArcadeAccess.queryOptions(), staleTime: STALE.viewer };
}

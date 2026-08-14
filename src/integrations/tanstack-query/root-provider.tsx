import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { markWrite } from "@/orpc/recent-write";

/**
 * Every successful mutation stamps the recent-write window, which flips
 * public-tier reads onto the private `no-store` mount so the writer sees
 * their own write instead of the edge cache's pre-write copy — see
 * src/orpc/recent-write.ts. Raw client calls that bypass useMutation
 * (the collab wizard's submit) call markWrite() themselves.
 */
function makeQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({ onSuccess: markWrite }),
  });
}

export function getContext() {
  const queryClient = makeQueryClient();
  return {
    queryClient,
  };
}

export default function TanStackQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

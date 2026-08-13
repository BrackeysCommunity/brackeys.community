import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRouterClient } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { isPublicProcedure } from "@/orpc/public-procedures";
import router from "@/orpc/router";

const getORPCClient = createIsomorphicFn()
  .server(() =>
    createRouterClient(router, {
      context: () => ({
        headers: getRequestHeaders(),
      }),
    }),
  )
  .client((): RouterClient<typeof router> => {
    const privateClient = createORPCClient(
      new RPCLink({ url: `${window.location.origin}/api/rpc` }),
    );
    const publicClient = createORPCClient(
      new RPCLink({
        url: `${window.location.origin}/api/public/rpc`,
        // GET is what makes these responses edge-cacheable. Inputs longer
        // than the URL budget fall back to POST — still correct, just a
        // cache miss.
        method: () => "GET",
        fallbackMethod: "POST",
      }),
    );

    // Both routers are flat and share procedure names, so dispatching by
    // name is the whole facade: `orpc.listJams…` keeps its call signature
    // and its TanStack Query key (keys derive from the property path, not
    // from the client), and simply travels to the cached mount instead.
    //
    // Merging has to be a Proxy: an oRPC client is itself a Proxy with no
    // enumerable keys, so spreading two of them yields `{}`.
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name) => {
        const source =
          typeof name === "string" && isPublicProcedure(name) ? publicClient : privateClient;
        return (source as Record<string | symbol, unknown>)[name];
      },
    }) as RouterClient<typeof router>;
  });

export const client: RouterClient<typeof router> = getORPCClient();

export const orpc = createTanstackQueryUtils(client);

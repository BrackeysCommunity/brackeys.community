import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRouterClient } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { isPublicProcedure } from "@/orpc/public-procedures";
import { markWrite, shouldBypassPublicCache } from "@/orpc/recent-write";
import router from "@/orpc/router";
import type AppRouter from "@/orpc/router";

/**
 * The router reaches the database, so its module graph must never land in the
 * browser bundle. It survives here only because the isomorphic transform
 * strips the `.server()` branch and then drops the now-unused value import.
 *
 * That elimination is load-bearing and fragile: a `typeof router` anywhere
 * outside the server branch keeps the value import alive, and drizzle, the
 * pg pool and every router file get bundled for the browser (where they die
 * on `Buffer is not defined`). Hence the type-only alias — every
 * client-visible mention of the router's shape goes through it.
 */
type AppClient = RouterClient<typeof AppRouter>;

const getORPCClient = createIsomorphicFn()
  .server(() =>
    createRouterClient(router, {
      context: () => ({
        headers: getRequestHeaders(),
      }),
    }),
  )
  .client((): AppClient => {
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

    // Reads follow the get/list/count/search naming convention throughout
    // the router; everything else is a write. Writes stamp the
    // recent-write window below, so the convention is load-bearing in
    // both directions: a write named `get…` would silently skip the
    // stamp, and a read that falls outside the convention (today only
    // `unreadCount`, which polls) would keep the window open forever.
    const EXTRA_READ_NAMES = new Set(["unreadCount"]);
    const isReadName = (name: string) =>
      /^(get|list|count|search)[A-Z]/.test(name) || EXTRA_READ_NAMES.has(name);

    // Both routers are flat and share procedure names, so dispatching by
    // name is the whole facade: `orpc.listJams…` keeps its call signature
    // and its TanStack Query key (keys derive from the property path, not
    // from the client), and simply travels to the cached mount instead.
    //
    // The decision is per property access, which is what lets the
    // recent-write bypass work: a successful write (any non-read
    // procedure, marked via the `apply` trap) flips public procedures
    // onto the private `no-store` mount for the next window, so the
    // writer reads their own write instead of the edge's pre-write copy
    // (see src/orpc/recent-write.ts).
    //
    // Merging has to be a Proxy: an oRPC client is itself a Proxy with no
    // enumerable keys, so spreading two of them yields `{}`.
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name) => {
        if (typeof name !== "string") {
          return (privateClient as Record<string | symbol, unknown>)[name];
        }
        const source =
          isPublicProcedure(name) && !shouldBypassPublicCache() ? publicClient : privateClient;
        const procedure = (source as Record<string, unknown>)[name];
        if (isPublicProcedure(name) || isReadName(name)) return procedure;
        // The apply trap (vs. a plain wrapper function) keeps the oRPC
        // procedure proxy's own properties reachable.
        return new Proxy(procedure as object, {
          apply: (target, thisArg, args: unknown[]) => {
            const result = Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
            return Promise.resolve(result).then((value) => {
              markWrite();
              return value;
            });
          },
        });
      },
    }) as AppClient;
  });

export const client: AppClient = getORPCClient();

export const orpc = createTanstackQueryUtils(client);

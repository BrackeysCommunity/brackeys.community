import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRouterClient } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

// Referenced only inside the `.server()` branch below, so the isomorphic
// transform drops it from the browser bundle along with the router — the
// same elimination the file comment describes. It must stay that way:
// posthog-server pulls in posthog-node.
import { reportProcedureErrors } from "@/orpc/error-reporting";
import { isPublicProcedure } from "@/orpc/public-procedures";
import { isReadName } from "@/orpc/read-names";
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
      // SSR loaders call the router in-process, never crossing the RPC
      // mounts — so the interceptors installed on those handlers don't see
      // any of this. Without a copy here, a procedure that throws while
      // server-rendering is reported nowhere.
      interceptors: [reportProcedureErrors("ssr")],
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

    // Both routers are flat and share procedure names, so dispatching by
    // name is the whole facade: `orpc.listJams…` keeps its call signature
    // and its TanStack Query key (keys derive from the property path, not
    // from the client), and simply travels to the cached mount instead.
    //
    // The decision has to be made inside the `apply` trap — i.e. when the
    // procedure is actually *called* — not inside `get`. `orpc.foo.queryOptions()`
    // (createTanstackQueryUtils, @orpc/tanstack-query) reads `client.foo`
    // once to build a `queryFn` closure, and that closure is only rebuilt
    // when the component holding the `useQuery` call next renders. A write
    // that lands in a sibling component (e.g. the profile edit flyout)
    // doesn't re-render the page's own query — so `invalidateQueries`'s
    // refetch runs whatever closure was captured on the *last* render,
    // which can predate the write. Resolving `public` vs `private` at
    // `get` time bakes that stale answer in; resolving it at `apply` time
    // means every fetch, including a refetch from an old closure, checks
    // `shouldBypassPublicCache()` fresh at the moment it actually goes out
    // (see src/orpc/recent-write.ts).
    //
    // Merging has to be a Proxy: an oRPC client is itself a Proxy with no
    // enumerable keys, so spreading two of them yields `{}`.
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name) => {
        if (typeof name !== "string") {
          return (privateClient as Record<string | symbol, unknown>)[name];
        }
        if (isPublicProcedure(name)) {
          const publicProcedure = (publicClient as Record<string, unknown>)[name];
          const privateProcedure = (privateClient as Record<string, unknown>)[name];
          // The apply trap (vs. a plain wrapper function) keeps the oRPC
          // procedure proxy's own properties reachable.
          return new Proxy(publicProcedure as object, {
            apply: (_target, thisArg, args: unknown[]) => {
              const target = shouldBypassPublicCache() ? privateProcedure : publicProcedure;
              return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
            },
          });
        }
        const procedure = (privateClient as Record<string, unknown>)[name];
        if (isReadName(name)) return procedure;
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

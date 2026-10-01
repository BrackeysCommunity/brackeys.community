// Storybook stand-in for `src/orpc/client.ts`. The real module picks its
// client through `createIsomorphicFn`, and only the TanStack Start plugin
// strips the `.server()` branch — without it the whole router, drizzle and
// posthog-node land in the preview bundle and the build fails. Stories only
// ever need the browser side.

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type AppRouter from "../src/orpc/router";

export const client: RouterClient<typeof AppRouter> = createORPCClient(
  new RPCLink({ url: `${window.location.origin}/api/rpc` }),
);

export const orpc = createTanstackQueryUtils(client);

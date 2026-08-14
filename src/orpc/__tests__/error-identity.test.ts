import { ORPCError as ClientORPCError } from "@orpc/client";
import { ORPCError as ServerORPCError } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

/**
 * Every deliberate failure in the router — `UNAUTHORIZED` from
 * `requireAuth`, `FORBIDDEN` for a ban, `NOT_FOUND`, validation messages —
 * is `throw new ORPCError(...)` imported from `@orpc/client`. The handler
 * that turns it into a response identifies it with `instanceof` against
 * `@orpc/server`'s copy of the class.
 *
 * Those are the same class only while a single copy of `@orpc/client` is
 * installed. `@orpc/server` pins its `@orpc/client` to an *exact* version,
 * so if the app's own `@orpc/client` drifts to a different one the package
 * manager nests a second copy, the `instanceof` silently goes false, and
 * every intended error becomes a generic 500 "Internal server error" — a
 * 401 becomes indistinguishable from a crash, and the user-facing message
 * is lost. Nothing else in the suite notices, because the code typechecks
 * and the procedures still behave correctly right up to the throw.
 *
 * This asserts the one invariant that prevents it.
 */
describe("ORPCError class identity", () => {
  it("resolves to a single class across @orpc/client and @orpc/server", () => {
    expect(
      ServerORPCError,
      "@orpc/client and @orpc/server resolved different copies of ORPCError — " +
        "run `vp dedupe` or align every @orpc/* package to one version",
    ).toBe(ClientORPCError);
  });

  it("recognises a router-thrown error as an ORPCError", () => {
    const thrown = new ClientORPCError("UNAUTHORIZED", { message: "Authentication required." });

    expect(thrown instanceof ServerORPCError).toBe(true);
    expect(thrown.code).toBe("UNAUTHORIZED");
    expect(thrown.status).toBe(401);
  });
});

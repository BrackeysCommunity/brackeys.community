/**
 * Helpers for calling oRPC procedures in DB-backed tests.
 *
 * Pairs with a `vi.mock("@/lib/auth", ...)` of `fakeAuthModule()`: the
 * middleware reads sessions through `auth.api.getSession({ headers })`, so a
 * header the test controls is the whole authentication story — no cookies,
 * no Discord round-trip.
 */

/** Call options for a request authenticated as `userId` (null = anonymous). */
export function asUser(userId: string | null): { context: { headers: Headers } } {
  const headers = new Headers();
  if (userId) headers.set("x-test-user", userId);
  return { context: { headers } };
}

/** The `@/lib/auth` module shape for `vi.mock`. */
export function fakeAuthModule() {
  return {
    auth: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get("x-test-user");
          if (!id) return null;
          return {
            session: { id: `session-${id}` },
            user: { id, name: id, bannedAt: null },
          };
        },
      },
    },
  } as unknown as typeof import("@/lib/auth");
}

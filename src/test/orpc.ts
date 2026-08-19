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

/**
 * The `@/lib/auth` module shape for `vi.mock`. Ban fields are read back from the
 * (mocked) database, as better-auth's `additionalFields` do in production.
 */
export function fakeAuthModule() {
  return {
    auth: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get("x-test-user");
          if (!id) return null;
          let ban = { bannedAt: null, bannedUntil: null, unbannedAt: null };
          try {
            const [{ db }, schema, { eq }] = await Promise.all([
              import("@/db"),
              import("@/db/schema"),
              import("drizzle-orm"),
            ]);
            const [row] = await db
              .select({
                bannedAt: schema.user.bannedAt,
                bannedUntil: schema.user.bannedUntil,
                unbannedAt: schema.user.unbannedAt,
              })
              .from(schema.user)
              .where(eq(schema.user.id, id))
              .limit(1);
            if (row) ban = row as typeof ban;
          } catch {
            // Tests that don't stand up a database keep the unbanned default.
          }
          return {
            session: { id: `session-${id}` },
            user: { id, name: id, ...ban },
          };
        },
      },
    },
  } as unknown as typeof import("@/lib/auth");
}

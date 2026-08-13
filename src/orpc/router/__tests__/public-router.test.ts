import { describe, expect, it } from "vite-plus/test";

import {
  authMiddleware,
  requireAdmin,
  requireAuth,
  requireAuthWithPermissions,
  requireGuildMember,
  requireStaff,
} from "@/orpc/middleware/auth";
import { PUBLIC_PROCEDURE_NAMES, isPublicProcedure } from "@/orpc/public-procedures";
import router from "@/orpc/router";
import { publicRouter } from "@/orpc/router/public";
import { anonymousContext } from "@/routes/api.public.rpc.$";

/**
 * The public tier's safety rests on responses being identical for every
 * caller — that is what makes them safe to hand to a shared edge cache.
 * These assertions are the code-level half of that guarantee (the mount
 * supplies the other half by never forwarding cookies).
 */

const ANY_MIDDLEWARE = [
  authMiddleware,
  requireAuth,
  requireGuildMember,
  requireAuthWithPermissions,
  requireStaff,
  requireAdmin,
] as const;
const SESSION_MIDDLEWARE = new Set<unknown>(ANY_MIDDLEWARE);

type Introspectable = {
  "~orpc": { middlewares: readonly unknown[]; route: { method?: string } };
};

function internals(procedure: unknown): Introspectable["~orpc"] {
  return (procedure as Introspectable)["~orpc"];
}

const entries = Object.entries(publicRouter as Record<string, unknown>);

describe("public router", () => {
  it("matches the shared name list the client facade routes by", () => {
    // client.ts dispatches on PUBLIC_PROCEDURE_NAMES but never imports the
    // router (that would drag the database into the browser bundle), so
    // drift between the two is only catchable here. Drift in one direction
    // sends calls to a mount that won't serve them; in the other it leaves
    // a cacheable read on the private tier.
    expect(Object.keys(publicRouter).sort()).toEqual([...PUBLIC_PROCEDURE_NAMES].sort());
  });

  it("reads no session — no procedure carries auth middleware", () => {
    for (const [name, procedure] of entries) {
      const withSession = internals(procedure).middlewares.filter((m) => SESSION_MIDDLEWARE.has(m));
      expect(
        withSession,
        `"${name}" is on the public tier but reads a session — its output could vary per caller ` +
          "and must not be edge-cached",
      ).toHaveLength(0);
    }
  });

  it("opts every procedure into GET, which StrictGetMethodPlugin requires", () => {
    for (const [name, procedure] of entries) {
      expect(
        internals(procedure).route.method,
        `"${name}" needs .route({ method: "GET" }) or the public mount will refuse it`,
      ).toBe("GET");
    }
  });

  it("shares procedure instances with the root router rather than copying them", () => {
    for (const [name, procedure] of entries) {
      expect(procedure, `"${name}" is missing from the root router`).toBe(
        (router as Record<string, unknown>)[name],
      );
    }
  });

  it("excludes resolveProjectForGame, whose read mints a row", () => {
    expect(isPublicProcedure("resolveProjectForGame")).toBe(false);
    expect(Object.keys(publicRouter)).not.toContain("resolveProjectForGame");
  });

  it("is mounted with a cookie-free context", () => {
    // The second of the three guards against session data reaching a shared
    // cache (the first is the no-auth-middleware test above; the third is
    // Cloudflare refusing to cache Set-Cookie responses).
    const { headers } = anonymousContext();
    expect([...headers.keys()]).toEqual([]);
  });

  it("is a subset of the procedures the lockdown test allows anonymously", () => {
    // Anonymous-callable is the weaker property; cacheable-public is the
    // stronger one. Anything here must already be classified as anonymous
    // in authorization.test.ts.
    for (const name of PUBLIC_PROCEDURE_NAMES) {
      const gated = internals((router as Record<string, unknown>)[name]).middlewares.some((m) =>
        SESSION_MIDDLEWARE.has(m),
      );
      expect(gated, `"${name}" is gated on the root router but exposed publicly`).toBe(false);
    }
  });
});

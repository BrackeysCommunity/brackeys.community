import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

/**
 * Where every auth error lands (`onAPIError.errorURL` in `src/lib/auth.ts`).
 *
 * better-auth's own `/api/auth/error` page is outside the router: it has the
 * app's URL but none of its chrome, and its only way out is a hard
 * navigation. The common case here isn't even an error — it's someone
 * pressing Cancel on a consent screen — so this says what happened and puts
 * them back where they were.
 *
 * The OAuth callbacks redirect here *before* parsing their state, which is
 * why a per-call `errorCallbackURL` can't cover a cancelled consent screen
 * and this route has to exist.
 */
const searchSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const Route = createFileRoute("/auth/error")({
  validateSearch: searchSchema,
  component: AuthErrorPage,
});

/** OAuth's error codes, in the member's terms rather than the spec's. */
function describeAuthError(code: string | undefined, description: string | undefined): string {
  switch (code) {
    case "access_denied":
      return "Cancelled — nothing was linked.";
    case "invalid_client":
    case "unauthorized_client":
      return "That provider rejected this app's credentials. Let staff know.";
    case "account_already_linked_to_different_user":
      return "That account is already linked to a different member.";
    case "email_doesn't_match":
      return "That account's email doesn't match this one.";
    case "signup disabled":
      return "Sign in with Discord first — other providers can only be linked to an account.";
    case "oAuth_code_missing":
      return "The provider sent us back without an authorization code.";
    default:
      // `undefined` reads as "undefined" once it has been through a query
      // string, which is worse than saying nothing.
      return description && description !== "undefined"
        ? description
        : "That didn't complete. Nothing was changed.";
  }
}

function AuthErrorPage() {
  const { error, error_description: description } = Route.useSearch();
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    // Wait for the session before choosing where "back" is: a cancelled
    // link belongs on the profile, a failed sign-in on the home page.
    if (isPending || handled.current) return;
    handled.current = true;

    const message = describeAuthError(error, description);
    if (error === "access_denied") toast(message);
    else toast.error(message);

    navigate({ to: session ? "/profile" : "/" });
  }, [error, description, session, isPending, navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Taking you back…</p>
      </div>
    </div>
  );
}

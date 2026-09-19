import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import * as z from "zod";

import { AccountSection } from "@/components/settings/AccountSection";
import { pageTitle } from "@/lib/site-meta";
import { toast } from "@/lib/toast";

/**
 * The provider's error handoff for a sign-in identity link started here
 * (`linkSigninProvider`). There is no sync step to run on the way back, so
 * the page is its own callback — and without taking the error too, a
 * cancelled consent screen would strand the member on better-auth's own
 * `/api/auth/error` page, outside the app.
 */
const searchSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const Route = createFileRoute("/settings/account")({
  validateSearch: searchSchema,
  component: AccountPage,
  head: () => ({ meta: [{ title: pageTitle("Account · Settings") }] }),
});

function AccountPage() {
  const { error, error_description: errorDescription } = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    if (!error) return;
    // A cancel is a decision, not a failure.
    if (error === "access_denied") toast("Linking cancelled.");
    else toast.error(errorDescription || `The provider returned "${error}".`);
    // Clear the handoff so a reload doesn't repeat the toast.
    void navigate({ to: "/settings/account", search: {}, replace: true });
  }, [error, errorDescription, navigate]);

  return <AccountSection />;
}

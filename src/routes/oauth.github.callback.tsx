import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import * as z from "zod";

import { reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

/** The provider's error handoff — see the GitLab callback for the why. */
const searchSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const Route = createFileRoute("/oauth/github/callback")({
  validateSearch: searchSchema,
  component: GitHubCallbackPage,
});

function GitHubCallbackPage() {
  const { error, error_description: errorDescription } = Route.useSearch();
  const navigate = useNavigate();
  const processed = useRef(false);

  const { mutate: syncGitHub } = useMutation({
    mutationFn: () => client.syncGitHubLink({}),
    onSuccess: (data) => {
      toast.success(`Linked GitHub account: ${data.providerUsername}`);
      navigate({ to: "/profile" });
    },
    onError: (err: Error) => {
      reportMutationError(
        err,
        "profile.link_github_callback",
        { provider: "github" },
        { reportExpected: true },
      );
      toast.error(err.message || "Failed to link GitHub account");
      navigate({ to: "/profile" });
    },
  });

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    if (error) {
      // A cancel is a decision, not a failure.
      if (error === "access_denied") toast("Linking cancelled.");
      else toast.error(errorDescription || `GitHub returned "${error}".`);
      navigate({ to: "/profile" });
      return;
    }
    syncGitHub();
  }, [syncGitHub, navigate, error, errorDescription]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">
          {error ? "Taking you back…" : "Linking your GitHub account..."}
        </p>
      </div>
    </div>
  );
}

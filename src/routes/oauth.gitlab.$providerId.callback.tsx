import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import * as z from "zod";

import { gitlabInstance } from "@/lib/gitlab-instances";
import { reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

/**
 * The provider's own error handoff, as `errorCallbackURL` — a cancelled
 * consent screen comes back here rather than stranding the member on
 * better-auth's `/api/auth/error` page, which is not part of this app and
 * has no way back into it.
 */
const searchSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const Route = createFileRoute("/oauth/gitlab/$providerId/callback")({
  validateSearch: searchSchema,
  component: GitLabCallbackPage,
});

/** GitLab's OAuth error codes, in the member's terms. */
function describeOAuthError(code: string, description?: string): string {
  if (code === "access_denied") return "Linking cancelled.";
  if (code === "invalid_client") {
    return "This GitLab instance rejected the app's credentials. Let staff know.";
  }
  return description || `GitLab returned "${code}".`;
}

function GitLabCallbackPage() {
  const { providerId } = Route.useParams();
  const { error, error_description: errorDescription } = Route.useSearch();
  const navigate = useNavigate();
  const processed = useRef(false);
  const instance = gitlabInstance(providerId);

  const { mutate: syncGitLab } = useMutation({
    mutationFn: () => client.syncGitLabLink({ providerId }),
    onSuccess: (data) => {
      toast.success(`Linked ${data.host} account: ${data.providerUsername}`);
      navigate({ to: "/profile" });
    },
    onError: (err: Error) => {
      reportMutationError(
        err,
        "profile.link_gitlab_callback",
        { provider: providerId },
        { reportExpected: true },
      );
      toast.error(err.message || "Failed to link GitLab account");
      navigate({ to: "/profile" });
    },
  });

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    // A cancel is a decision, not a failure: say so plainly and put them
    // back where they pressed the button.
    if (error) {
      const message = describeOAuthError(error, errorDescription);
      if (error === "access_denied") toast(message);
      else toast.error(message);
      navigate({ to: "/profile" });
      return;
    }
    if (!instance) {
      toast.error("Unknown GitLab instance.");
      navigate({ to: "/profile" });
      return;
    }
    syncGitLab();
  }, [syncGitLab, instance, navigate, error, errorDescription]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">
          {error ? "Taking you back…" : `Linking your ${instance?.host ?? "GitLab"} account...`}
        </p>
      </div>
    </div>
  );
}

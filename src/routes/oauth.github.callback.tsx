import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { client } from "@/orpc/client";

export const Route = createFileRoute("/oauth/github/callback")({
  component: GitHubCallbackPage,
});

function GitHubCallbackPage() {
  const navigate = useNavigate();
  const processed = useRef(false);

  const { mutate: syncGitHub } = useMutation({
    mutationFn: () => client.syncGitHubLink({}),
    onSuccess: (data) => {
      toast.success(`Linked GitHub account: ${data.providerUsername}`);
      navigate({ to: "/profile" });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to link GitHub account");
      navigate({ to: "/profile" });
    },
  });

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    syncGitHub();
  }, [syncGitHub]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="font-mono text-sm text-muted-foreground">Linking your GitHub account...</p>
      </div>
    </div>
  );
}

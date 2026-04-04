import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { client } from "@/orpc/client";

export const Route = createFileRoute("/oauth/github/callback")({
  component: GitHubCallbackPage,
});

function GitHubCallbackPage() {
  const navigate = useNavigate();
  const processed = useRef(false);

  const syncMutation = useMutation({
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
    syncMutation.mutate();
  }, [syncMutation.mutate]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-3">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
        <p className="font-mono text-sm text-muted-foreground">Linking your GitHub account...</p>
      </div>
    </div>
  );
}

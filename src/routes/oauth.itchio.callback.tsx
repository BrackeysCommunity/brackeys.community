import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { client } from "@/orpc/client";

export const Route = createFileRoute("/oauth/itchio/callback")({
  component: ItchIoCallbackPage,
});

function ItchIoCallbackPage() {
  const navigate = useNavigate();
  const processed = useRef(false);

  // Linking just stores the access token. Once that succeeds we
  // kick off `importItchIoGames` to pull the user's published games
  // into their `profile_projects` so they show up in the PROJECTS
  // section without a manual import step. Import errors are
  // surfaced as a toast but don't block the navigation back —
  // linking already succeeded and the user can re-run the import
  // from the projects section if it failed.
  const { mutate: importGames } = useMutation({
    mutationFn: () => client.importItchIoGames({}),
    onSuccess: (data) => {
      const count =
        typeof data === "object" && data && "imported" in data
          ? (data as { imported?: number }).imported
          : undefined;
      toast.success(
        count != null
          ? `Imported ${count} game${count === 1 ? "" : "s"} from itch.io`
          : "Imported your itch.io games",
      );
    },
    onError: (err: Error) => {
      toast.error(
        err.message || "Linked, but couldn't import your games — try again from PROJECTS",
      );
    },
    onSettled: () => navigate({ to: "/profile" }),
  });

  const { mutate: linkItchIo } = useMutation({
    mutationFn: (accessToken: string) => client.linkItchIo({ accessToken }),
    onSuccess: (data) => {
      toast.success(`Linked itch.io account: ${data.providerUsername}`);
      importGames();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to link itch.io account");
      navigate({ to: "/profile" });
    },
  });

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const state = params.get("state");

    // If this is a proxied request from a preview env, bounce there with the token
    if (state && accessToken) {
      window.location.href = `${state}/oauth/itchio/callback#access_token=${accessToken}`;
      return;
    }

    if (!accessToken) {
      toast.error("No access token received from itch.io");
      navigate({ to: "/profile" });
      return;
    }

    linkItchIo(accessToken);
  }, [linkItchIo, navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="font-mono text-sm text-muted-foreground">Linking your itch.io account...</p>
      </div>
    </div>
  );
}

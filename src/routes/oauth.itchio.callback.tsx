import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { describeLinkImport } from "@/lib/itchio-import-copy";
import {
  buildPreviewBounceUrl,
  consumeStoredNonce,
  isAllowedPreviewOrigin,
  parseOAuthState,
} from "@/lib/itchio-oauth";
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
      toast.success(describeLinkImport(data));
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
      if (data.gamesScopeMissing) {
        // The identity linked fine but itch didn't grant the games scope —
        // importing would just 403, so skip it and say why.
        toast.warning(
          "Linked, but itch.io didn't grant games access — re-link and approve all permissions to import your games",
        );
        navigate({ to: "/profile" });
        return;
      }
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
    // Scrub the token from the URL before anything else runs — it must not
    // linger in history or leak via referrer.
    window.history.replaceState(null, "", window.location.pathname);

    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const state = params.get("state");
    const { nonce, origin } = parseOAuthState(state);

    // Preview flows route through this (registered) production callback;
    // `state` carries the initiating origin. Only allowlisted preview
    // origins get the token forwarded, and the full state goes with it —
    // the preview callback runs its own nonce check on arrival.
    if (accessToken && state && origin && origin !== window.location.origin) {
      if (!isAllowedPreviewOrigin(origin)) {
        toast.error("Unrecognized preview environment");
        navigate({ to: "/profile" });
        return;
      }
      window.location.href = buildPreviewBounceUrl(origin, accessToken, state);
      return;
    }

    if (!accessToken) {
      // Almost always the user clicking cancel on itch's consent page.
      toast.error("itch.io link canceled");
      navigate({ to: "/profile" });
      return;
    }

    // CSRF check: the callback only acts when `state` echoes the single-use
    // nonce this session stored when it started the flow. Without this,
    // a crafted callback URL could link an attacker's itch account.
    const storedNonce = consumeStoredNonce();
    if (!nonce || !storedNonce || nonce !== storedNonce) {
      toast.error("itch.io link could not be verified — please try again");
      navigate({ to: "/profile" });
      return;
    }

    linkItchIo(accessToken);
  }, [linkItchIo, navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Linking your itch.io account...</p>
      </div>
    </div>
  );
}

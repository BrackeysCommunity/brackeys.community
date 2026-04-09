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

  const { mutate: linkItchIo } = useMutation({
    mutationFn: (accessToken: string) => client.linkItchIo({ accessToken }),
    onSuccess: (data) => {
      toast.success(`Linked itch.io account: ${data.providerUsername}`);
      navigate({ to: "/profile" });
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

import { createFileRoute } from "@tanstack/react-router";

import { CollabPostPage } from "@/components/collab/CollabPostPage";

export const Route = createFileRoute("/collab/$postId")({
  component: CollabPostPage,
});

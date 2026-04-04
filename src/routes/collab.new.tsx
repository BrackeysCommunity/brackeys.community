import { createFileRoute } from "@tanstack/react-router";
import { CollabCreatePage } from "@/components/collab/CollabCreatePage";

export const Route = createFileRoute("/collab/new")({
  component: CollabCreatePage,
});

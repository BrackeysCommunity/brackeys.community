import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/collab/new")({
  beforeLoad: () => {
    throw redirect({ to: "/collab", search: { new: true } });
  },
});

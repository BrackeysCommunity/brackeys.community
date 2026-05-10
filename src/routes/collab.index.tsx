import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CollabBrowsePage } from "@/components/collab/CollabBrowsePage";

// Validates the URL search params: `?new=true` opens the create flyout
// (set by the legacy /collab/new route's redirect), and `?post=<id>`
// opens the post detail popover so direct links land on the right post.
const searchSchema = z.object({
  new: z.boolean().optional(),
  post: z.coerce.number().int().positive().optional(),
});

export const Route = createFileRoute("/collab/")({
  validateSearch: searchSchema,
  component: CollabBrowsePage,
});

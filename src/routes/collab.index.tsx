import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CollabBrowsePage } from "@/components/collab/CollabBrowsePage";

// Validates the URL search params:
//   `?new=true`    opens the create flyout (set by the legacy
//                  /collab/new route's redirect)
//   `?post=<id>`   opens the post detail popover so direct links land on
//                  the right post
//   `?jam=<id>`    filters the board to one jam — or, alongside `new`,
//                  preselects that jam in the wizard (the jam modal's
//                  "FIND A TEAM" CTA sends both)
//   `?skills=…`    tech-stack filter, so a narrowed board is shareable
//   `?team=<id>`   filters the board to one team's posts (set by the
//                  team page's "see all" link) — or, alongside `new`,
//                  pre-links that team in the wizard (the team page's
//                  "POST AN OPENING" CTA)
//   `?project=<id>` filters the board to one project's posts (set by the
//                  project page's RECRUITING section) — or, alongside
//                  `new`, pre-links that project in the wizard (the
//                  project page's "RECRUIT" CTA)
const searchSchema = z.object({
  new: z.boolean().optional(),
  post: z.coerce.number().int().positive().optional(),
  jam: z.coerce.number().int().positive().optional(),
  skills: z.array(z.coerce.number().int().positive()).optional(),
  team: z.string().optional(),
  project: z.string().optional(),
});

export const Route = createFileRoute("/collab/")({
  validateSearch: searchSchema,
  component: CollabBrowsePage,
});

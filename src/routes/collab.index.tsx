import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CollabBrowsePage } from "@/components/collab/CollabBrowsePage";

// Validates the URL search params. The board's filters live entirely in
// the URL (see `collab-filters.ts`), so every narrowed board is
// shareable/bookmarkable. Beyond the filters:
//   `?new=true`    opens the create flyout (set by the legacy
//                  /collab/new route's redirect). Alongside it, `jam`/
//                  `team`/`project` preselect in the wizard instead of
//                  filtering the board (the jam modal's "FIND A TEAM",
//                  the team page's "POST AN OPENING", and the project
//                  page's "RECRUIT" CTAs send those pairs).
//   `?post=<id>`   opens the post detail popover so direct links land on
//                  the right post
const searchSchema = z.object({
  new: z.boolean().optional(),
  post: z.coerce.number().int().positive().optional(),
  type: z.enum(["paid", "hobby"]).optional(),
  status: z.enum(["recruiting", "party_full"]).optional(),
  level: z.enum(["beginner", "intermediate", "experienced"]).optional(),
  comp: z.enum(["hourly", "fixed", "rev_share", "negotiable"]).optional(),
  solo: z.boolean().optional(),
  q: z.string().optional(),
  roles: z.array(z.coerce.number().int().positive()).optional(),
  skills: z.array(z.coerce.number().int().positive()).optional(),
  jam: z.coerce.number().int().positive().optional(),
  team: z.string().optional(),
  project: z.string().optional(),
  sort: z.enum(["newest", "oldest", "active"]).optional(),
});

export const Route = createFileRoute("/collab/")({
  validateSearch: searchSchema,
  component: CollabBrowsePage,
});

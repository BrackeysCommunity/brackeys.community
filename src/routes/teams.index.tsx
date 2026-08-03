import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { TeamsDiscoveryPage } from "@/components/teams/TeamsDiscoveryPage";

// Validates the URL search params:
//   `?q=…`           name/tagline search
//   `?recruiting=1`  only teams taking members
//   `?shipped=1`     only teams with something on the showcase
//   `?skills=…`      derived stack filter (the roster's skills)
//   `?sort=…`        listing order; `active` is the default and stays out
//                    of the URL
//   `?new=1`         opens the create drawer on arrival
const skillId = z.coerce.number().int().positive();

const searchSchema = z.object({
  q: z.string().optional(),
  recruiting: z.boolean().optional(),
  shipped: z.boolean().optional(),
  // A one-skill URL parses as a bare number, not a one-element array —
  // the page always writes arrays, but a hand-typed or trimmed link
  // must not throw the route into its error boundary.
  skills: z.union([z.array(skillId), skillId.transform((id) => [id])]).optional(),
  sort: z.enum(["active", "shipped", "newest"]).optional(),
  new: z.boolean().optional(),
});

export const Route = createFileRoute("/teams/")({
  validateSearch: searchSchema,
  component: TeamsDiscoveryPage,
});

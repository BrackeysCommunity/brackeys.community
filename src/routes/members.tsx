import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { MembersDiscoveryPage } from "@/components/members/MembersDiscoveryPage";

// Validates the URL search params:
//   `?q=…`            username/tagline/looking-for search
//   `?skills=…`       skills the member has on their profile
//   `?availability=…` commitment level, any of full_time/part_time/limited
//   `?open=1`         only members flagged open to work
//   `?rate=50`        hourly ceiling in whole dollars
//   `?sort=…`         listing order; `active` is the default and stays out
//                     of the URL
const skillId = z.coerce.number().int().positive();
const availability = z.enum(["full_time", "part_time", "limited"]);

const searchSchema = z.object({
  q: z.string().optional(),
  // A one-value URL parses as a bare scalar, not a one-element array —
  // the page always writes arrays, but a hand-typed or trimmed link must
  // not throw the route into its error boundary.
  skills: z.union([z.array(skillId), skillId.transform((id) => [id])]).optional(),
  availability: z
    .union([z.array(availability), availability.transform((value) => [value])])
    .optional(),
  open: z.boolean().optional(),
  rate: z.coerce.number().int().positive().optional(),
  sort: z.enum(["active", "newest", "rate"]).optional(),
});

export const Route = createFileRoute("/members")({
  validateSearch: searchSchema,
  component: MembersDiscoveryPage,
});

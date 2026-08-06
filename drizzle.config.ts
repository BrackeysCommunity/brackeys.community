import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: [".env.local", ".env"] });

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Every pg schema `src/db/schema.ts` declares. `team` and `project` were
  // missing here; drizzle derives the schemas it manages from the definitions
  // themselves, so generate still saw them — but `introspect`/`pull` and
  // `push` honour this list, and would have reported the team tables as
  // extraneous.
  schemaFilter: ["public", "auth", "user", "hammer", "collab", "team", "itch", "project"],
});

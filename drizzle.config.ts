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
  // Every pg schema `src/db/schema.ts` declares. `hammer` is deliberately
  // absent: the Hammer bot's EF Core migrations own that schema, and this
  // list keeps `introspect`/`pull`/`push` from reporting its tables as
  // drift (`generate` derives its schemas from the definitions themselves,
  // and `src/db/hammer.ts` sits outside the `schema` path above).
  schemaFilter: ["public", "auth", "user", "collab", "team", "itch", "project", "social"],
});

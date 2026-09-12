CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "projects_title_trgm_idx" ON "project"."projects" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projects_slug_trgm_idx" ON "project"."projects" USING gin ("slug" gin_trgm_ops);
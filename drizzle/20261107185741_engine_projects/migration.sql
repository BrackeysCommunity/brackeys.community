CREATE TABLE "canvas"."engine_agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"access" text NOT NULL,
	"label" text NOT NULL,
	"token_sha256" text NOT NULL UNIQUE,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "engine_agent_tokens_access" CHECK ("access" IN ('read', 'write')),
	CONSTRAINT "engine_agent_tokens_sha256" CHECK ("token_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_asset_docs" (
	"project_id" text,
	"asset_key" text,
	"kind" text NOT NULL,
	"state" bytea,
	"seed" text,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"schema_version" integer,
	"snapshot" text,
	"content_sha256" text,
	"last_edited_by_id" text,
	"last_edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "engine_asset_docs_pkey" PRIMARY KEY("project_id","asset_key"),
	CONSTRAINT "engine_asset_docs_key" CHECK ("asset_key" ~ '^[a-z0-9][a-z0-9-]{0,47}$')
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_blobs" (
	"project_id" text,
	"sha256" text,
	"byte_size" integer NOT NULL,
	"content_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_referenced_at" timestamp,
	CONSTRAINT "engine_blobs_pkey" PRIMARY KEY("project_id","sha256"),
	CONSTRAINT "engine_blobs_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_projects" (
	"project_id" text PRIMARY KEY,
	"name" text NOT NULL,
	"game" text,
	"state" bytea,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"layout" integer DEFAULT 1 NOT NULL,
	"team_id" text,
	"created_by_id" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "engine_projects_id" CHECK ("project_id" ~ '^[a-z0-9][a-z0-9-]{0,47}$')
);
--> statement-breakpoint
ALTER TABLE "canvas"."scene_docs" ADD COLUMN "project_id" text;--> statement-breakpoint
CREATE INDEX "engine_agent_tokens_project_idx" ON "canvas"."engine_agent_tokens" ("project_id");--> statement-breakpoint
CREATE INDEX "scene_docs_project_idx" ON "canvas"."scene_docs" ("project_id");--> statement-breakpoint
ALTER TABLE "canvas"."engine_agent_tokens" ADD CONSTRAINT "engine_agent_tokens_project_id_engine_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_agent_tokens" ADD CONSTRAINT "engine_agent_tokens_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_asset_docs" ADD CONSTRAINT "engine_asset_docs_project_id_engine_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_asset_docs" ADD CONSTRAINT "engine_asset_docs_last_edited_by_id_user_id_fkey" FOREIGN KEY ("last_edited_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_blobs" ADD CONSTRAINT "engine_blobs_project_id_engine_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_blobs" ADD CONSTRAINT "engine_blobs_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD CONSTRAINT "engine_projects_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD CONSTRAINT "engine_projects_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."scene_docs" ADD CONSTRAINT "scene_docs_project_id_engine_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
-- Backfill: one engine project per scene id prefix, named after it; the engine's own project has no game.
INSERT INTO "canvas"."engine_projects" ("project_id", "name", "game")
SELECT DISTINCT split_part("scene_id", '.', 1), split_part("scene_id", '.', 1), NULLIF(split_part("scene_id", '.', 1), 'engine')
FROM "canvas"."scene_docs"
ON CONFLICT ("project_id") DO NOTHING;--> statement-breakpoint
UPDATE "canvas"."scene_docs" SET "project_id" = split_part("scene_id", '.', 1) WHERE "project_id" IS NULL;

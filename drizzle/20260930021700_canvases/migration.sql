CREATE SCHEMA "canvas";
--> statement-breakpoint
CREATE TABLE "canvas"."attachments" (
	"id" text PRIMARY KEY,
	"owner_id" text,
	"team_id" text,
	"path" text NOT NULL,
	"path_key" text GENERATED ALWAYS AS (lower(normalize(path, NFC))) STORED NOT NULL,
	"image_key" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"quarantined_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "canvas"."doc_versions" (
	"id" bigserial PRIMARY KEY,
	"doc_kind" text NOT NULL,
	"doc_id" text NOT NULL,
	"taken_at" timestamp DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"state" bytea NOT NULL,
	"byte_size" integer NOT NULL,
	CONSTRAINT "doc_versions_kind" CHECK ("doc_kind" IN ('canvas', 'note')),
	CONSTRAINT "doc_versions_reason" CHECK ("reason" IN ('hourly', 'pre-restore', 'pre-link', 'pre-import', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "canvas"."canvas_docs" (
	"canvas_id" text PRIMARY KEY,
	"state" bytea NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas"."canvas_members" (
	"canvas_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"invited_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_members_canvas_user_uq" UNIQUE("canvas_id","user_id"),
	CONSTRAINT "canvas_members_role" CHECK ("role" IN ('editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "canvas"."opens" (
	"user_id" text,
	"doc_kind" text,
	"doc_id" text,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opens_pkey" PRIMARY KEY("user_id","doc_kind","doc_id")
);
--> statement-breakpoint
CREATE TABLE "canvas"."canvases" (
	"id" text PRIMARY KEY,
	"owner_id" text,
	"team_id" text,
	"path" text NOT NULL,
	"path_key" text GENERATED ALWAYS AS (lower(normalize(path, NFC))) STORED NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"snapshot" jsonb DEFAULT '{"nodes":[],"edges":[]}' NOT NULL,
	"node_count" integer DEFAULT 0 NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"last_edited_by_id" text,
	"last_edited_at" timestamp,
	"hidden_at" timestamp,
	"hidden_by_id" text,
	"hidden_reason" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "canvases_visibility" CHECK ("visibility" IN ('private', 'team', 'unlisted', 'public'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_team_path_uq" ON "canvas"."attachments" ("team_id","path_key") WHERE "team_id" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_personal_path_uq" ON "canvas"."attachments" ("owner_id","path_key") WHERE "team_id" IS NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "attachments_image_key_idx" ON "canvas"."attachments" ("image_key");--> statement-breakpoint
CREATE INDEX "doc_versions_doc_idx" ON "canvas"."doc_versions" ("doc_kind","doc_id","taken_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "doc_versions_taken_idx" ON "canvas"."doc_versions" ("taken_at");--> statement-breakpoint
CREATE INDEX "canvas_members_user_idx" ON "canvas"."canvas_members" ("user_id");--> statement-breakpoint
CREATE INDEX "opens_user_recent_idx" ON "canvas"."opens" ("user_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "canvases_team_path_uq" ON "canvas"."canvases" ("team_id","path_key") WHERE "team_id" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "canvases_personal_path_uq" ON "canvas"."canvases" ("owner_id","path_key") WHERE "team_id" IS NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "canvases_owner_idx" ON "canvas"."canvases" ("owner_id","deleted_at");--> statement-breakpoint
CREATE INDEX "canvases_team_idx" ON "canvas"."canvases" ("team_id","deleted_at");--> statement-breakpoint
CREATE INDEX "canvases_public_idx" ON "canvas"."canvases" ("updated_at" DESC NULLS LAST) WHERE "visibility" = 'public' AND "hidden_at" IS NULL AND "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "canvas"."attachments" ADD CONSTRAINT "attachments_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."attachments" ADD CONSTRAINT "attachments_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."canvas_docs" ADD CONSTRAINT "canvas_docs_canvas_id_canvases_id_fkey" FOREIGN KEY ("canvas_id") REFERENCES "canvas"."canvases"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."canvas_members" ADD CONSTRAINT "canvas_members_canvas_id_canvases_id_fkey" FOREIGN KEY ("canvas_id") REFERENCES "canvas"."canvases"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."canvas_members" ADD CONSTRAINT "canvas_members_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."canvas_members" ADD CONSTRAINT "canvas_members_invited_by_id_user_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."opens" ADD CONSTRAINT "opens_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."canvases" ADD CONSTRAINT "canvases_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."canvases" ADD CONSTRAINT "canvases_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."canvases" ADD CONSTRAINT "canvases_last_edited_by_id_user_id_fkey" FOREIGN KEY ("last_edited_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."canvases" ADD CONSTRAINT "canvases_hidden_by_id_user_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;
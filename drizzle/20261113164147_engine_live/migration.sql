CREATE TABLE "canvas"."engine_live_reports" (
	"version_id" text,
	"user_id" text,
	"channel" text NOT NULL,
	"outcome" text NOT NULL,
	"issue_code" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engine_live_reports_pkey" PRIMARY KEY("version_id","user_id"),
	CONSTRAINT "engine_live_reports_channel" CHECK ("channel" IN ('preview', 'production')),
	CONSTRAINT "engine_live_reports_outcome" CHECK ("outcome" IN ('applied', 'refused', 'failed', 'crashed'))
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_scene_channels" (
	"project_id" text,
	"channel" text,
	"scene_id" text,
	"version_id" text NOT NULL,
	"timing" text NOT NULL,
	"extra_bytes" bigint DEFAULT 0 NOT NULL,
	"updated_by_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "engine_scene_channels_pkey" PRIMARY KEY("project_id","channel","scene_id"),
	CONSTRAINT "engine_scene_channels_channel" CHECK ("channel" IN ('preview', 'production')),
	CONSTRAINT "engine_scene_channels_timing" CHECK ("timing" IN ('next-load', 'boundary', 'now')),
	CONSTRAINT "engine_scene_channels_extra_bytes" CHECK ("extra_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_scene_version_files" (
	"version_id" text,
	"sha256" text,
	"bytes" integer NOT NULL,
	"role" text NOT NULL,
	"ext" text NOT NULL,
	"source" text NOT NULL,
	"project_id" text NOT NULL,
	CONSTRAINT "engine_scene_version_files_pkey" PRIMARY KEY("version_id","sha256"),
	CONSTRAINT "engine_scene_version_files_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "engine_scene_version_files_role" CHECK ("role" IN ('version', 'scene', 'prefab', 'doc', 'blob')),
	CONSTRAINT "engine_scene_version_files_ext" CHECK ("ext" ~ '^[.][a-z0-9]{1,8}$'),
	CONSTRAINT "engine_scene_version_files_source" CHECK ("source" IN ('release', 'blob'))
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_scene_versions" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"scene_id" text NOT NULL,
	"number" integer NOT NULL,
	"descriptor" text,
	"compat_key" text NOT NULL,
	"base_release_id" text,
	"physics" text NOT NULL,
	"scene_hash" text NOT NULL,
	"data_bytes" integer NOT NULL,
	"note" text,
	"created_by_id" text,
	"agent_token_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"collected_at" timestamp,
	"hidden_at" timestamp,
	"hidden_by_id" text,
	"hidden_reason" text,
	"blocked_at" timestamp,
	"blocked_by" text,
	"blocked_by_id" text,
	"block_reason" text,
	"reports_ok" integer DEFAULT 0 NOT NULL,
	"reports_failed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "engine_scene_versions_id" CHECK ("id" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "engine_scene_versions_compat_key" CHECK ("compat_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "engine_scene_versions_scene_hash" CHECK ("scene_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "engine_scene_versions_base_release" CHECK ("base_release_id" IS NULL OR "base_release_id" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "engine_scene_versions_number" CHECK ("number" >= 1),
	CONSTRAINT "engine_scene_versions_physics" CHECK ("physics" IN ('rapier', 'none')),
	CONSTRAINT "engine_scene_versions_data_bytes" CHECK ("data_bytes" >= 0),
	CONSTRAINT "engine_scene_versions_note" CHECK ("note" IS NULL OR char_length("note") <= 200),
	CONSTRAINT "engine_scene_versions_blocked_by" CHECK (("blocked_by" IS NULL AND "blocked_at" IS NULL) OR ("blocked_by" IN ('system', 'user') AND "blocked_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_audit" ADD COLUMN "scene_id" text;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_audit" ADD COLUMN "scene_version_id" text;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_channels" ADD COLUMN "live_rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD COLUMN "kind" text DEFAULT 'release' NOT NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD COLUMN "scene_id" text;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD COLUMN "timing" text;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "canvas"."engine_releases" ADD COLUMN "live_compat_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "engine_live_reports_at_idx" ON "canvas"."engine_live_reports" ("at");--> statement-breakpoint
CREATE INDEX "engine_scene_channels_version_idx" ON "canvas"."engine_scene_channels" ("version_id");--> statement-breakpoint
CREATE INDEX "engine_scene_version_files_hash_idx" ON "canvas"."engine_scene_version_files" ("project_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "engine_scene_versions_scene_number_uq" ON "canvas"."engine_scene_versions" ("project_id","scene_id","number" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "canvas"."engine_live_reports" ADD CONSTRAINT "engine_live_reports_version_id_engine_scene_versions_id_fkey" FOREIGN KEY ("version_id") REFERENCES "canvas"."engine_scene_versions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_live_reports" ADD CONSTRAINT "engine_live_reports_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_scene_channels" ADD CONSTRAINT "engine_scene_channels_qRiOvQ3D5raW_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_scene_channels" ADD CONSTRAINT "engine_scene_channels_version_id_engine_scene_versions_id_fkey" FOREIGN KEY ("version_id") REFERENCES "canvas"."engine_scene_versions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "canvas"."engine_scene_channels" ADD CONSTRAINT "engine_scene_channels_updated_by_id_user_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_scene_version_files" ADD CONSTRAINT "engine_scene_version_files_JkY2ecn3NIEv_fkey" FOREIGN KEY ("version_id") REFERENCES "canvas"."engine_scene_versions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_scene_version_files" ADD CONSTRAINT "engine_scene_version_files_6umRx22WgL4O_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_scene_versions" ADD CONSTRAINT "engine_scene_versions_qVr77iskUzUv_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_scene_versions" ADD CONSTRAINT "engine_scene_versions_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_scene_versions" ADD CONSTRAINT "engine_scene_versions_j7vhJPilTNql_fkey" FOREIGN KEY ("agent_token_id") REFERENCES "canvas"."engine_agent_tokens"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_scene_versions" ADD CONSTRAINT "engine_scene_versions_hidden_by_id_user_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_scene_versions" ADD CONSTRAINT "engine_scene_versions_blocked_by_id_user_id_fkey" FOREIGN KEY ("blocked_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD CONSTRAINT "engine_release_uploads_kind" CHECK ("kind" IN ('release', 'scene'));--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD CONSTRAINT "engine_release_uploads_scene" CHECK (("kind" = 'scene') = ("scene_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD CONSTRAINT "engine_release_uploads_timing" CHECK ("timing" IS NULL OR "timing" IN ('next-load', 'boundary', 'now'));--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD CONSTRAINT "engine_release_uploads_note" CHECK ("note" IS NULL OR char_length("note") <= 200);--> statement-breakpoint
ALTER TABLE "canvas"."engine_releases" ADD CONSTRAINT "engine_releases_live_compat_key" CHECK ("live_compat_key" = '' OR "live_compat_key" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_audit" DROP CONSTRAINT "engine_release_audit_action", ADD CONSTRAINT "engine_release_audit_action" CHECK ("action" IN ('create', 'promote', 'rollback', 'visibility', 'jam-link', 'jam-unlink', 'hide', 'unhide', 'collect', 'approve-public', 'settings', 'report-resolved', 'scene-create', 'scene-promote', 'scene-rollback', 'scene-clear', 'scene-block', 'scene-unblock', 'scene-hide', 'scene-unhide', 'scene-collect'));
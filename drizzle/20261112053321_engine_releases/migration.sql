CREATE TABLE "canvas"."engine_release_audit" (
	"id" bigserial PRIMARY KEY,
	"project_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"agent_token_id" uuid,
	"action" text NOT NULL,
	"release_id" text,
	"channel" text,
	"from_release" text,
	"to_release" text,
	"detail" jsonb DEFAULT '{}' NOT NULL,
	CONSTRAINT "engine_release_audit_actor_kind" CHECK ("actor_kind" IN ('user', 'agent', 'staff', 'system')),
	CONSTRAINT "engine_release_audit_action" CHECK ("action" IN ('create', 'promote', 'rollback', 'visibility', 'jam-link', 'jam-unlink', 'hide', 'unhide', 'collect', 'approve-public', 'settings', 'report-resolved')),
	CONSTRAINT "engine_release_audit_channel" CHECK ("channel" IS NULL OR "channel" IN ('preview', 'production'))
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_release_channels" (
	"project_id" text,
	"channel" text,
	"release_id" text NOT NULL,
	"updated_by_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "engine_release_channels_pkey" PRIMARY KEY("project_id","channel"),
	CONSTRAINT "engine_release_channels_channel" CHECK ("channel" IN ('preview', 'production'))
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_release_files" (
	"release_id" text,
	"project_id" text NOT NULL,
	"path" text,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"role" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "engine_release_files_pkey" PRIMARY KEY("release_id","path"),
	CONSTRAINT "engine_release_files_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "engine_release_files_role" CHECK ("role" IN ('code', 'style', 'wasm', 'shell', 'worker', 'icon', 'asset', 'data')),
	CONSTRAINT "engine_release_files_source" CHECK ("source" IN ('release', 'blob'))
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_release_jam_links" (
	"project_id" text,
	"jam_id" integer,
	"release_id" text NOT NULL,
	"linked_by_id" text,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "engine_release_jam_links_pkey" PRIMARY KEY("project_id","jam_id")
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_release_objects" (
	"project_id" text,
	"sha256" text,
	"bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"quarantined_at" timestamp,
	CONSTRAINT "engine_release_objects_pkey" PRIMARY KEY("project_id","sha256"),
	CONSTRAINT "engine_release_objects_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_release_reports" (
	"id" bigserial PRIMARY KEY,
	"project_id" text,
	"release_id" text,
	"version" integer,
	"title" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"resolution" text,
	CONSTRAINT "engine_release_reports_resolution" CHECK ("resolution" IS NULL OR "resolution" IN ('hidden-release', 'hidden-project', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_release_uploads" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"manifest" text NOT NULL,
	"release_id" text NOT NULL,
	"missing" jsonb DEFAULT '[]' NOT NULL,
	"channel" text DEFAULT 'preview' NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"agent_token_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"committed_at" timestamp,
	CONSTRAINT "engine_release_uploads_release_id" CHECK ("release_id" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "engine_release_uploads_channel" CHECK ("channel" IN ('preview', 'none')),
	CONSTRAINT "engine_release_uploads_actor_kind" CHECK ("actor_kind" IN ('user', 'agent', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "canvas"."engine_releases" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"manifest" text,
	"manifest_bytes" integer NOT NULL,
	"total_bytes" bigint NOT NULL,
	"file_count" integer NOT NULL,
	"engine_version" text NOT NULL,
	"game_id" text NOT NULL,
	"snapshot" text NOT NULL,
	"build_hash" text NOT NULL,
	"target" text NOT NULL,
	"created_by_id" text,
	"agent_token_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"first_promoted_at" timestamp,
	"collected_at" timestamp,
	"hidden_at" timestamp,
	"hidden_by_id" text,
	"hidden_reason" text,
	CONSTRAINT "engine_releases_id" CHECK ("id" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "engine_releases_snapshot" CHECK ("snapshot" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "engine_releases_build_hash" CHECK ("build_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "engine_releases_version" CHECK ("version" >= 1),
	CONSTRAINT "engine_releases_target" CHECK ("target" IN ('web', 'itch'))
);
--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "showcase_project_id" text;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "public_review_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "public_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "public_approved_by_id" text;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "hidden_by_id" text;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "connect_origins" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "save_mode" text DEFAULT 'site' NOT NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD COLUMN "online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD CONSTRAINT "engine_projects_showcase_project_id_key" UNIQUE("showcase_project_id");--> statement-breakpoint
CREATE INDEX "engine_release_audit_project_at_idx" ON "canvas"."engine_release_audit" ("project_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "engine_release_files_hash_idx" ON "canvas"."engine_release_files" ("project_id","sha256");--> statement-breakpoint
CREATE INDEX "engine_release_jam_links_release_idx" ON "canvas"."engine_release_jam_links" ("release_id");--> statement-breakpoint
CREATE INDEX "engine_release_reports_open_idx" ON "canvas"."engine_release_reports" ("created_at" DESC NULLS LAST) WHERE "resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "engine_release_reports_reporter_idx" ON "canvas"."engine_release_reports" ("reporter_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "engine_release_uploads_project_idx" ON "canvas"."engine_release_uploads" ("project_id");--> statement-breakpoint
CREATE INDEX "engine_release_uploads_open_idx" ON "canvas"."engine_release_uploads" ("expires_at") WHERE "committed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "engine_releases_project_version_uq" ON "canvas"."engine_releases" ("project_id","version");--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD CONSTRAINT "engine_projects_showcase_project_id_projects_id_fkey" FOREIGN KEY ("showcase_project_id") REFERENCES "project"."projects"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD CONSTRAINT "engine_projects_public_approved_by_id_user_id_fkey" FOREIGN KEY ("public_approved_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD CONSTRAINT "engine_projects_hidden_by_id_user_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_audit" ADD CONSTRAINT "engine_release_audit_project_id_engine_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_audit" ADD CONSTRAINT "engine_release_audit_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_audit" ADD CONSTRAINT "engine_release_audit_agent_token_id_engine_agent_tokens_id_fkey" FOREIGN KEY ("agent_token_id") REFERENCES "canvas"."engine_agent_tokens"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_channels" ADD CONSTRAINT "engine_release_channels_FufakZJAlOhz_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_channels" ADD CONSTRAINT "engine_release_channels_release_id_engine_releases_id_fkey" FOREIGN KEY ("release_id") REFERENCES "canvas"."engine_releases"("id");--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_channels" ADD CONSTRAINT "engine_release_channels_updated_by_id_user_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_files" ADD CONSTRAINT "engine_release_files_release_id_engine_releases_id_fkey" FOREIGN KEY ("release_id") REFERENCES "canvas"."engine_releases"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_files" ADD CONSTRAINT "engine_release_files_project_id_engine_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_jam_links" ADD CONSTRAINT "engine_release_jam_links_xn6wi38yqPTL_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_jam_links" ADD CONSTRAINT "engine_release_jam_links_jam_id_jams_jam_id_fkey" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams"("jam_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_jam_links" ADD CONSTRAINT "engine_release_jam_links_release_id_engine_releases_id_fkey" FOREIGN KEY ("release_id") REFERENCES "canvas"."engine_releases"("id");--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_jam_links" ADD CONSTRAINT "engine_release_jam_links_linked_by_id_user_id_fkey" FOREIGN KEY ("linked_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_objects" ADD CONSTRAINT "engine_release_objects_8UpWxFayFjsf_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_reports" ADD CONSTRAINT "engine_release_reports_c1Oac6S6SqB2_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_reports" ADD CONSTRAINT "engine_release_reports_release_id_engine_releases_id_fkey" FOREIGN KEY ("release_id") REFERENCES "canvas"."engine_releases"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_reports" ADD CONSTRAINT "engine_release_reports_reporter_id_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_reports" ADD CONSTRAINT "engine_release_reports_resolved_by_id_user_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD CONSTRAINT "engine_release_uploads_JmljomwH442l_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD CONSTRAINT "engine_release_uploads_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_release_uploads" ADD CONSTRAINT "engine_release_uploads_3FUokqZxoCfN_fkey" FOREIGN KEY ("agent_token_id") REFERENCES "canvas"."engine_agent_tokens"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_releases" ADD CONSTRAINT "engine_releases_project_id_engine_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_releases" ADD CONSTRAINT "engine_releases_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_releases" ADD CONSTRAINT "engine_releases_agent_token_id_engine_agent_tokens_id_fkey" FOREIGN KEY ("agent_token_id") REFERENCES "canvas"."engine_agent_tokens"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_releases" ADD CONSTRAINT "engine_releases_hidden_by_id_user_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD CONSTRAINT "engine_projects_visibility" CHECK ("visibility" IN ('private', 'team', 'unlisted', 'public'));--> statement-breakpoint
ALTER TABLE "canvas"."engine_projects" ADD CONSTRAINT "engine_projects_save_mode" CHECK ("save_mode" IN ('site', 'own', 'none'));
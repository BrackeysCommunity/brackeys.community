CREATE SCHEMA "media";
--> statement-breakpoint
CREATE TABLE "social"."image_flags" (
	"id" bigserial PRIMARY KEY,
	"object_key" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"uploader_id" text,
	"kind" text NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"score" real,
	"evidence" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media"."image_scans" (
	"object_key" text PRIMARY KEY,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"uploader_id" text,
	"phash" text,
	"nsfw_score" real,
	"embedding" bytea,
	"embedding_model" text,
	"detector_version" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"detached" jsonb,
	"scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itch"."jam_scans" (
	"jam_id" integer PRIMARY KEY,
	"banner_url" text,
	"banner_status" text DEFAULT 'fetched' NOT NULL,
	"banner_phash" text,
	"nsfw_score" real,
	"banner_embedding" bytea,
	"embedding_model" text,
	"detector_version" integer NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itch"."tier_heartbeats" (
	"tier" text PRIMARY KEY,
	"next_run_at" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itch"."entry_scans" ADD COLUMN "cover_status" text DEFAULT 'fetched' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "image_flags_open_kind_uidx" ON "social"."image_flags" ("object_key","kind") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "image_flags_owner_idx" ON "social"."image_flags" ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "image_flags_status_idx" ON "social"."image_flags" ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "image_scans_owner_idx" ON "media"."image_scans" ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "image_scans_status_idx" ON "media"."image_scans" ("status");--> statement-breakpoint
ALTER TABLE "social"."image_flags" ADD CONSTRAINT "image_flags_object_key_image_scans_object_key_fkey" FOREIGN KEY ("object_key") REFERENCES "media"."image_scans"("object_key") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."image_flags" ADD CONSTRAINT "image_flags_uploader_id_user_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social"."image_flags" ADD CONSTRAINT "image_flags_resolved_by_id_user_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "media"."image_scans" ADD CONSTRAINT "image_scans_uploader_id_user_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "itch"."jam_scans" ADD CONSTRAINT "jam_scans_jam_id_jams_jam_id_fkey" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams"("jam_id") ON DELETE CASCADE;--> statement-breakpoint
UPDATE "itch"."entry_scans" SET "cover_status" = CASE
	WHEN "cover_url" IS NULL THEN 'none'
	WHEN "cover_phash" IS NOT NULL OR "cover_embedding" IS NOT NULL THEN 'fetched'
	ELSE 'gone' END;--> statement-breakpoint
INSERT INTO "media"."image_scans" ("object_key", "owner_type", "owner_id", "uploader_id")
SELECT k.object_key, k.owner_type, k.owner_id, u.id
FROM (
	SELECT t.avatar_key AS object_key, 'team_avatar' AS owner_type, t.id AS owner_id, t.created_by AS uploader_id
		FROM "team"."teams" t WHERE t.avatar_key IS NOT NULL
	UNION ALL
	SELECT t.banner_key, 'team_banner', t.id, t.created_by
		FROM "team"."teams" t WHERE t.banner_key IS NOT NULL
	UNION ALL
	SELECT i.image_key, 'collab_post_image', i.post_id::text, p.author_id
		FROM "collab"."collab_post_images" i JOIN "collab"."collab_posts" p ON p.id = i.post_id
	UNION ALL
	SELECT pr.image_key, 'project_cover', pr.id, pr.created_by
		FROM "project"."projects" pr WHERE pr.image_key IS NOT NULL
	UNION ALL
	SELECT pp.image_key, 'profile_project_image', pp.profile_id, pp.profile_id
		FROM "user"."profile_projects" pp WHERE pp.image_key IS NOT NULL
	UNION ALL
	SELECT tp.image_key, 'team_project_image', tp.team_id, tp.added_by
		FROM "team"."team_projects" tp WHERE tp.image_key IS NOT NULL AND tp.team_id IS NOT NULL
) k
LEFT JOIN "auth"."user" u ON u.id = k.uploader_id
WHERE k.object_key ~ '^(profile-projects|team-avatars|team-banners|project-images|collab-post-images|team-projects)/'
ON CONFLICT ("object_key") DO NOTHING;

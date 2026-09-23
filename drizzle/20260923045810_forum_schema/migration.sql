CREATE SCHEMA "forum";
--> statement-breakpoint
ALTER TYPE "social"."thread_subject_type" ADD VALUE 'forum_post';--> statement-breakpoint
CREATE TABLE "forum"."bookmarks" (
	"user_id" text,
	"post_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_pkey" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "forum"."categories" (
	"id" serial PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"posting_policy" text DEFAULT 'anyone' NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "forum_categories_posting_policy" CHECK ("posting_policy" IN ('anyone', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "forum"."follows" (
	"follower_id" text,
	"target_type" text,
	"target_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "follows_pkey" PRIMARY KEY("follower_id","target_type","target_id"),
	CONSTRAINT "forum_follows_target_type" CHECK ("target_type" IN ('team', 'user', 'tag', 'category', 'series'))
);
--> statement-breakpoint
CREATE TABLE "forum"."post_authors" (
	"post_id" integer,
	"user_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "post_authors_pkey" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "forum"."post_images" (
	"id" serial PRIMARY KEY,
	"post_id" integer NOT NULL,
	"image_key" text NOT NULL,
	"url" text NOT NULL,
	"alt" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum"."post_reports" (
	"id" serial PRIMARY KEY,
	"post_id" integer NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text
);
--> statement-breakpoint
CREATE TABLE "forum"."post_tags" (
	"post_id" integer,
	"tag_id" integer,
	CONSTRAINT "post_tags_pkey" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "forum"."posts" (
	"id" serial PRIMARY KEY,
	"kind" text NOT NULL,
	"category_id" integer NOT NULL,
	"author_id" text,
	"team_id" text,
	"title" text,
	"slug" text,
	"body" text NOT NULL,
	"excerpt" text,
	"cover_image_key" text,
	"cover_image_url" text,
	"series_id" integer,
	"series_index" integer,
	"project_id" text,
	"jam_id" integer,
	"collab_post_id" integer,
	"status" text DEFAULT 'published' NOT NULL,
	"published_at" timestamp,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"pinned_at" timestamp,
	"pinned_scope" text,
	"hidden_at" timestamp,
	"hidden_by_id" text,
	"hidden_reason" text,
	"solved_comment_id" bigint,
	"like_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "forum_posts_kind" CHECK ("kind" IN ('post', 'devlog', 'question')),
	CONSTRAINT "forum_posts_status" CHECK ("status" IN ('draft', 'published')),
	CONSTRAINT "forum_posts_pinned_scope" CHECK ("pinned_scope" IS NULL OR "pinned_scope" IN ('global', 'category')),
	CONSTRAINT "forum_posts_title_required" CHECK ("kind" = 'post' OR "title" IS NOT NULL),
	CONSTRAINT "forum_posts_team_devlog_only" CHECK ("team_id" IS NULL OR "kind" = 'devlog'),
	CONSTRAINT "forum_posts_solved_question_only" CHECK ("solved_comment_id" IS NULL OR "kind" = 'question'),
	CONSTRAINT "forum_posts_published_at" CHECK ("status" <> 'published' OR "published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "forum"."reactions" (
	"post_id" integer,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_pkey" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "forum"."series" (
	"id" serial PRIMARY KEY,
	"team_id" text,
	"owner_user_id" text,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "forum_series_one_owner" CHECK (num_nonnulls("team_id", "owner_user_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "forum"."tags" (
	"id" serial PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" integer,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "forum_tags_slug_format" CHECK ("slug" ~ '^[a-z0-9-]{2,32}$'),
	CONSTRAINT "forum_tags_status" CHECK ("status" IN ('active', 'banned')),
	CONSTRAINT "forum_tags_not_self_merged" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id")
);
--> statement-breakpoint
ALTER TABLE "social"."threads" ADD COLUMN "forum_post_id" integer;--> statement-breakpoint
CREATE INDEX "forum_bookmarks_user_idx" ON "forum"."bookmarks" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "forum_follows_target_idx" ON "forum"."follows" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "forum_post_images_post_idx" ON "forum"."post_images" ("post_id","sort_order");--> statement-breakpoint
CREATE INDEX "forum_post_tags_tag_idx" ON "forum"."post_tags" ("tag_id","post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forum_posts_series_index_uq" ON "forum"."posts" ("series_id","series_index") WHERE "series_id" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "forum_posts_feed_idx" ON "forum"."posts" ("published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "status" = 'published' AND "hidden_at" IS NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "forum_posts_category_idx" ON "forum"."posts" ("category_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "forum_posts_team_idx" ON "forum"."posts" ("team_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "forum_posts_author_idx" ON "forum"."posts" ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "forum_posts_title_trgm_idx" ON "forum"."posts" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "forum_reactions_user_idx" ON "forum"."reactions" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "forum_series_team_slug_uq" ON "forum"."series" ("team_id","slug") WHERE "team_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "forum_series_owner_slug_uq" ON "forum"."series" ("owner_user_id","slug") WHERE "owner_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "forum_tags_usage_idx" ON "forum"."tags" ("usage_count" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "threads_forum_post_uq" ON "social"."threads" ("forum_post_id") WHERE "forum_post_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "forum"."bookmarks" ADD CONSTRAINT "bookmarks_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."bookmarks" ADD CONSTRAINT "bookmarks_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."follows" ADD CONSTRAINT "follows_follower_id_user_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."post_authors" ADD CONSTRAINT "post_authors_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."post_authors" ADD CONSTRAINT "post_authors_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."post_images" ADD CONSTRAINT "post_images_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."post_reports" ADD CONSTRAINT "post_reports_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."post_reports" ADD CONSTRAINT "post_reports_reporter_id_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."post_reports" ADD CONSTRAINT "post_reports_resolved_by_id_user_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forum"."post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "forum"."tags"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."posts" ADD CONSTRAINT "posts_category_id_categories_id_fkey" FOREIGN KEY ("category_id") REFERENCES "forum"."categories"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "forum"."posts" ADD CONSTRAINT "posts_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forum"."posts" ADD CONSTRAINT "posts_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forum"."posts" ADD CONSTRAINT "posts_series_id_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "forum"."series"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forum"."posts" ADD CONSTRAINT "posts_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"."projects"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forum"."posts" ADD CONSTRAINT "posts_jam_id_jams_jam_id_fkey" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams"("jam_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forum"."posts" ADD CONSTRAINT "posts_collab_post_id_collab_posts_id_fkey" FOREIGN KEY ("collab_post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forum"."posts" ADD CONSTRAINT "posts_hidden_by_id_user_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forum"."posts" ADD CONSTRAINT "posts_solved_comment_id_comments_id_fkey" FOREIGN KEY ("solved_comment_id") REFERENCES "social"."comments"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forum"."reactions" ADD CONSTRAINT "reactions_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."reactions" ADD CONSTRAINT "reactions_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."series" ADD CONSTRAINT "series_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"."teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."series" ADD CONSTRAINT "series_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."tags" ADD CONSTRAINT "tags_merged_into_id_tags_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "forum"."tags"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forum"."tags" ADD CONSTRAINT "tags_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social"."threads" ADD CONSTRAINT "threads_forum_post_id_posts_id_fkey" FOREIGN KEY ("forum_post_id") REFERENCES "forum"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."threads" DROP CONSTRAINT "threads_one_subject", ADD CONSTRAINT "threads_one_subject" CHECK (num_nonnulls("collab_post_id", "profile_user_id", "collab_response_id", "forum_post_id") = 1);--> statement-breakpoint
ALTER TABLE "social"."threads" DROP CONSTRAINT "threads_subject_type_matches", ADD CONSTRAINT "threads_subject_type_matches" CHECK (("subject_type"::text = 'collab_post') = ("collab_post_id" IS NOT NULL)
      AND ("subject_type"::text = 'profile') = ("profile_user_id" IS NOT NULL)
      AND ("subject_type"::text = 'collab_response') = ("collab_response_id" IS NOT NULL)
      AND ("subject_type"::text = 'forum_post') = ("forum_post_id" IS NOT NULL));--> statement-breakpoint
INSERT INTO "forum"."categories" ("slug", "name", "description", "color", "sort_order", "posting_policy") VALUES
  ('devlogs', 'Devlogs', 'Progress write-ups from teams and solo devs.', '#8b5cf6', 10, 'anyone'),
  ('show-and-tell', 'Show & Tell', 'Screenshots, clips and things you made.', '#f59e0b', 20, 'anyone'),
  ('help', 'Help', 'Questions about engines, code, art, audio and shipping.', '#10b981', 30, 'anyone'),
  ('jam-talk', 'Jam Talk', 'Themes, post-mortems and everything around the jams.', '#ef4444', 40, 'anyone'),
  ('feedback', 'Feedback', 'Ask for playtests and critique.', '#3b82f6', 50, 'anyone'),
  ('off-topic', 'Off-topic', 'Anything else worth keeping.', '#64748b', 60, 'anyone'),
  ('announcements', 'Announcements', 'News from the Brackeys staff.', '#ec4899', 0, 'staff');

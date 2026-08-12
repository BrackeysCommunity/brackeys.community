CREATE SCHEMA "social";
--> statement-breakpoint
CREATE TYPE "social"."thread_subject_type" AS ENUM('collab_post', 'profile');--> statement-breakpoint
CREATE TABLE "social"."comment_reports" (
	"id" bigserial PRIMARY KEY,
	"comment_id" bigint NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text
);
--> statement-breakpoint
CREATE TABLE "social"."comments" (
	"id" bigserial PRIMARY KEY,
	"thread_id" bigint NOT NULL,
	"parent_id" bigint,
	"root_id" bigint,
	"depth" integer DEFAULT 0 NOT NULL,
	"author_id" text,
	"content" text NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"deleted_by_id" text,
	CONSTRAINT "comments_root_iff_parent" CHECK (("parent_id" IS NULL) = ("root_id" IS NULL)),
	CONSTRAINT "comments_depth_matches" CHECK (("parent_id" IS NULL) = ("depth" = 0))
);
--> statement-breakpoint
CREATE TABLE "social"."thread_subscriptions" (
	"thread_id" bigint,
	"user_id" text,
	"muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "thread_subscriptions_pkey" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "social"."threads" (
	"id" bigserial PRIMARY KEY,
	"subject_type" "social"."thread_subject_type" NOT NULL,
	"collab_post_id" integer,
	"profile_user_id" text,
	"locked_at" timestamp,
	"locked_by_id" text,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"last_comment_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "threads_one_subject" CHECK (num_nonnulls("collab_post_id", "profile_user_id") = 1),
	CONSTRAINT "threads_subject_type_matches" CHECK (("subject_type" = 'collab_post') = ("collab_post_id" IS NOT NULL)
      AND ("subject_type" = 'profile') = ("profile_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "social"."user_blocks" (
	"blocker_id" text,
	"blocked_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_pkey" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE INDEX "comments_thread_toplevel_idx" ON "social"."comments" ("thread_id","id" DESC NULLS LAST) WHERE "parent_id" IS NULL;--> statement-breakpoint
CREATE INDEX "comments_root_idx" ON "social"."comments" ("root_id","id");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "social"."comments" ("author_id");--> statement-breakpoint
CREATE INDEX "thread_subs_user_idx" ON "social"."thread_subscriptions" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_collab_post_uq" ON "social"."threads" ("collab_post_id") WHERE "collab_post_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "threads_profile_uq" ON "social"."threads" ("profile_user_id") WHERE "profile_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "social"."user_blocks" ("blocked_id");--> statement-breakpoint
ALTER TABLE "social"."comment_reports" ADD CONSTRAINT "comment_reports_comment_id_comments_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "social"."comments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."comment_reports" ADD CONSTRAINT "comment_reports_reporter_id_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."comment_reports" ADD CONSTRAINT "comment_reports_resolved_by_id_user_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social"."comments" ADD CONSTRAINT "comments_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "social"."threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."comments" ADD CONSTRAINT "comments_parent_id_comments_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "social"."comments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."comments" ADD CONSTRAINT "comments_root_id_comments_id_fkey" FOREIGN KEY ("root_id") REFERENCES "social"."comments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."comments" ADD CONSTRAINT "comments_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social"."comments" ADD CONSTRAINT "comments_deleted_by_id_user_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social"."thread_subscriptions" ADD CONSTRAINT "thread_subscriptions_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "social"."threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."thread_subscriptions" ADD CONSTRAINT "thread_subscriptions_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."threads" ADD CONSTRAINT "threads_collab_post_id_collab_posts_id_fkey" FOREIGN KEY ("collab_post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."threads" ADD CONSTRAINT "threads_profile_user_id_user_id_fkey" FOREIGN KEY ("profile_user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."threads" ADD CONSTRAINT "threads_locked_by_id_user_id_fkey" FOREIGN KEY ("locked_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social"."user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_user_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_user_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;
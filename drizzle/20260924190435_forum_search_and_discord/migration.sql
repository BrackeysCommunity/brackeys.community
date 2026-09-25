CREATE TABLE "forum"."post_discord_shares" (
	"post_id" integer PRIMARY KEY,
	"channel_id" text NOT NULL,
	"message_id" text,
	"shared_by_id" text,
	"shared_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forum"."posts" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', body), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "forum_posts_search_idx" ON "forum"."posts" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "forum"."post_discord_shares" ADD CONSTRAINT "post_discord_shares_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum"."posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forum"."post_discord_shares" ADD CONSTRAINT "post_discord_shares_shared_by_id_user_id_fkey" FOREIGN KEY ("shared_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;
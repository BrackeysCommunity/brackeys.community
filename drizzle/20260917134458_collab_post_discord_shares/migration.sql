CREATE TABLE "collab"."collab_post_discord_shares" (
	"post_id" integer PRIMARY KEY,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"shared_by_id" text,
	"shared_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collab"."collab_post_discord_shares" ADD CONSTRAINT "collab_post_discord_shares_post_id_collab_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_discord_shares" ADD CONSTRAINT "collab_post_discord_shares_shared_by_id_user_id_fkey" FOREIGN KEY ("shared_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;
CREATE TABLE "user"."banner_history" (
	"user_id" text,
	"banner_id" text,
	"first_seen_at" timestamp NOT NULL,
	"closed_at" timestamp,
	CONSTRAINT "banner_history_pkey" PRIMARY KEY("user_id","banner_id")
);
--> statement-breakpoint
ALTER TABLE "user"."banner_history" ADD CONSTRAINT "banner_history_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;
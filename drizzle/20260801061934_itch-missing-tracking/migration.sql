CREATE TABLE "itch"."missing_jams" (
	"slug" text PRIMARY KEY,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itch"."jam_entries" ADD COLUMN "missing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "itch"."jams" ADD COLUMN "missing_since" timestamp with time zone;
CREATE TABLE "itch"."scrape_cursors" (
	"name" text PRIMARY KEY,
	"position" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

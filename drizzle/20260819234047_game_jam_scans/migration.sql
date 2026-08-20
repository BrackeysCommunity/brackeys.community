CREATE TABLE "itch"."game_jam_scans" (
	"game_id" bigint PRIMARY KEY,
	"game_url" text NOT NULL,
	"jam_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);

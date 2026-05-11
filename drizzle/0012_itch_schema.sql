-- Add new schema named "itch"
CREATE SCHEMA "itch";
-- Create "jams" table
CREATE TABLE "itch"."jams" (
  "jam_id" integer NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "banner_url" text NULL,
  "hashtag" text NULL,
  "hosts" jsonb NOT NULL DEFAULT '[]',
  "status" text NOT NULL,
  "starts_at" timestamptz NULL,
  "ends_at" timestamptz NULL,
  "voting_ends_at" timestamptz NULL,
  "entries_count" integer NULL,
  "ratings_count" integer NULL,
  "content_html" text NULL,
  "scraped_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("jam_id"),
  CONSTRAINT "jams_slug_unique" UNIQUE ("slug")
);
-- Create "jam_entries" table
CREATE TABLE "itch"."jam_entries" (
  "entry_id" bigint NOT NULL,
  "jam_id" integer NOT NULL,
  "game_id" bigint NOT NULL,
  "rate_url" text NOT NULL,
  "rating_count" integer NOT NULL DEFAULT 0,
  "coolness" integer NOT NULL DEFAULT 0,
  "submitted_at" timestamptz NULL,
  "game_title" text NOT NULL,
  "game_short_text" text NULL,
  "game_url" text NOT NULL,
  "game_cover_url" text NULL,
  "game_cover_color" text NULL,
  "game_platforms" text[] NULL,
  "author_id" bigint NULL,
  "author_name" text NULL,
  "author_url" text NULL,
  "contributors" jsonb NOT NULL DEFAULT '[]',
  "results_fetched_at" timestamptz NULL,
  "scraped_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("entry_id"),
  CONSTRAINT "jam_entries_jam_id_jams_jam_id_fk" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams" ("jam_id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create "jam_entry_results" table
CREATE TABLE "itch"."jam_entry_results" (
  "entry_id" bigint NOT NULL,
  "criterion" text NOT NULL,
  "rank" integer NOT NULL,
  "score" numeric(6,3) NOT NULL,
  "raw_score" numeric(6,3) NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "jam_entry_results_entry_id_criterion_pk" PRIMARY KEY ("entry_id", "criterion"),
  CONSTRAINT "jam_entry_results_entry_id_jam_entries_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "itch"."jam_entries" ("entry_id") ON UPDATE NO ACTION ON DELETE CASCADE
);

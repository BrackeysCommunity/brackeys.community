CREATE TABLE "mmo"."house_log" (
	"world_id" text,
	"id" bigserial,
	"server" text NOT NULL,
	"tick" bigint NOT NULL,
	"key" text NOT NULL,
	"character_id" text DEFAULT '' NOT NULL,
	"discord_id" text DEFAULT '' NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"what" text NOT NULL,
	"points" bigint DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "house_log_pkey" PRIMARY KEY("world_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "house_log_world_key_uq" ON "mmo"."house_log" ("world_id","key");--> statement-breakpoint
CREATE INDEX "house_log_world_server_idx" ON "mmo"."house_log" ("world_id","server","id");
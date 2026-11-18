CREATE SCHEMA "mmo";
--> statement-breakpoint
CREATE TABLE "mmo"."action" (
	"world_id" text,
	"seq" bigint,
	"interaction_id" text NOT NULL,
	"after_tick" bigint NOT NULL,
	"character_id" text NOT NULL,
	"kind" text NOT NULL,
	"command" jsonb NOT NULL,
	"reply" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_pkey" PRIMARY KEY("world_id","seq"),
	CONSTRAINT "action_world_interaction_uq" UNIQUE("world_id","interaction_id")
);
--> statement-breakpoint
CREATE TABLE "mmo"."character" (
	"world_id" text,
	"id" text,
	"discord_id" text NOT NULL,
	"version" bigint NOT NULL,
	"q" integer NOT NULL,
	"r" integer NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "character_pkey" PRIMARY KEY("world_id","id"),
	CONSTRAINT "character_world_discord_uq" UNIQUE("world_id","discord_id")
);
--> statement-breakpoint
CREATE TABLE "mmo"."fact" (
	"world_id" text,
	"id" bigint,
	"tick" bigint NOT NULL,
	"kind" text NOT NULL,
	"region" text,
	"weight" integer NOT NULL,
	"subjects" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"causes" jsonb NOT NULL,
	"staged_by" jsonb,
	"at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "fact_pkey" PRIMARY KEY("world_id","id","at")
) PARTITION BY RANGE ("at");
--> statement-breakpoint
-- Edited by hand: drizzle cannot declare partitions. The world service
-- creates each month's partition ahead of time; the default one only
-- catches a write that arrives before it.
CREATE TABLE "mmo"."fact_default" PARTITION OF "mmo"."fact" DEFAULT;
--> statement-breakpoint
CREATE TABLE "mmo"."faction" (
	"world_id" text,
	"idx" integer,
	"body" jsonb NOT NULL,
	CONSTRAINT "faction_pkey" PRIMARY KEY("world_id","idx")
);
--> statement-breakpoint
CREATE TABLE "mmo"."ledger_entry" (
	"world_id" text,
	"txn" bigint,
	"leg" integer,
	"account" text NOT NULL,
	"asset" text NOT NULL,
	"units" bigint NOT NULL,
	CONSTRAINT "ledger_entry_pkey" PRIMARY KEY("world_id","txn","leg")
);
--> statement-breakpoint
CREATE TABLE "mmo"."ledger_txn" (
	"world_id" text,
	"txn" bigint,
	"key" text NOT NULL,
	"tick" bigint NOT NULL,
	"kind" text NOT NULL,
	"fact_id" bigint,
	CONSTRAINT "ledger_txn_pkey" PRIMARY KEY("world_id","txn"),
	CONSTRAINT "ledger_txn_world_key_uq" UNIQUE("world_id","key")
);
--> statement-breakpoint
CREATE TABLE "mmo"."notable" (
	"world_id" text,
	"faction" integer,
	"idx" integer,
	"body" jsonb NOT NULL,
	CONSTRAINT "notable_pkey" PRIMARY KEY("world_id","faction","idx")
);
--> statement-breakpoint
CREATE TABLE "mmo"."region_state" (
	"world_id" text,
	"region" integer,
	"lattice_i" integer NOT NULL,
	"lattice_j" integer NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "region_state_pkey" PRIMARY KEY("world_id","region")
);
--> statement-breakpoint
CREATE TABLE "mmo"."snapshot" (
	"world_id" text,
	"tick" bigint,
	"seq" bigint NOT NULL,
	"digest" text NOT NULL,
	"body" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_pkey" PRIMARY KEY("world_id","tick")
);
--> statement-breakpoint
CREATE TABLE "mmo"."tick" (
	"world_id" text,
	"tick" bigint,
	"digest" text NOT NULL,
	"facts" integer NOT NULL,
	"ms" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tick_pkey" PRIMARY KEY("world_id","tick")
);
--> statement-breakpoint
CREATE TABLE "mmo"."tile" (
	"world_id" text,
	"q" integer,
	"r" integer,
	"seq" bigint NOT NULL,
	"found_tick" bigint,
	"body" jsonb NOT NULL,
	CONSTRAINT "tile_pkey" PRIMARY KEY("world_id","q","r")
);
--> statement-breakpoint
CREATE TABLE "mmo"."world" (
	"id" text PRIMARY KEY,
	"key_version" integer NOT NULL,
	"key_check" text NOT NULL,
	"rules_epoch" integer NOT NULL,
	"tick" bigint DEFAULT 0 NOT NULL,
	"season" integer DEFAULT 0 NOT NULL,
	"disposable" boolean DEFAULT true NOT NULL,
	"sheets_digest" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"tick_seconds" integer NOT NULL,
	"sim" jsonb NOT NULL,
	"digest" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "action_world_tick_idx" ON "mmo"."action" ("world_id","after_tick");--> statement-breakpoint
CREATE INDEX "fact_world_tick_idx" ON "mmo"."fact" ("world_id","tick");--> statement-breakpoint
CREATE INDEX "ledger_entry_world_account_idx" ON "mmo"."ledger_entry" ("world_id","account");--> statement-breakpoint
CREATE INDEX "tile_world_seq_idx" ON "mmo"."tile" ("world_id","seq");
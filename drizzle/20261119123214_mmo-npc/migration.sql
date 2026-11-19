CREATE TABLE "mmo"."npc" (
	"world_id" text,
	"seq" bigint,
	"id" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "npc_pkey" PRIMARY KEY("world_id","seq"),
	CONSTRAINT "npc_world_id_uq" UNIQUE("world_id","id")
);
--> statement-breakpoint
CREATE INDEX "fact_world_weight_idx" ON "mmo"."fact" ("world_id","weight","tick");
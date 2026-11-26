CREATE TABLE "mmo"."map_seen" (
	"world_id" text,
	"holder_kind" text,
	"holder_id" text,
	"q" bigint,
	"r" bigint,
	"chunk_a" bigint NOT NULL,
	"chunk_b" bigint NOT NULL,
	"left_tick" bigint NOT NULL,
	"live" jsonb NOT NULL,
	CONSTRAINT "map_seen_pkey" PRIMARY KEY("world_id","holder_kind","holder_id","q","r")
);
--> statement-breakpoint
CREATE TABLE "mmo"."map_sight" (
	"world_id" text,
	"holder_kind" text,
	"holder_id" text,
	"key" jsonb NOT NULL,
	"tick" bigint NOT NULL,
	CONSTRAINT "map_sight_pkey" PRIMARY KEY("world_id","holder_kind","holder_id")
);
--> statement-breakpoint
CREATE INDEX "map_seen_world_holder_chunk_idx" ON "mmo"."map_seen" ("world_id","holder_kind","holder_id","chunk_a","chunk_b");
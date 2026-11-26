CREATE TABLE "mmo"."epoch_note" (
	"world_id" text,
	"season" bigint,
	"from_digest" text NOT NULL,
	"to_digest" text NOT NULL,
	"roll_from" integer NOT NULL,
	"roll_to" integer NOT NULL,
	"notes" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "epoch_note_pkey" PRIMARY KEY("world_id","season")
);

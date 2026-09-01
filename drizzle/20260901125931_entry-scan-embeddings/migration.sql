ALTER TABLE "itch"."entry_scans" ADD COLUMN "cover_embedding" bytea;--> statement-breakpoint
ALTER TABLE "itch"."entry_scans" ADD COLUMN "embedding_model" text;
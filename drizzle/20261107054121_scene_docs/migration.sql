CREATE TABLE "canvas"."scene_docs" (
	"scene_id" text PRIMARY KEY,
	"state" bytea,
	"seed" text,
	"snapshot" text,
	"scene_hash" text,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"schema_version" integer,
	"created_by_id" text,
	"last_edited_by_id" text,
	"last_edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scene_docs_id" CHECK ("scene_id" ~ '^[a-z0-9][a-z0-9-]{0,47}\.[a-z0-9][a-z0-9-]{0,47}$')
);
--> statement-breakpoint
ALTER TABLE "canvas"."scene_docs" ADD CONSTRAINT "scene_docs_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."scene_docs" ADD CONSTRAINT "scene_docs_last_edited_by_id_user_id_fkey" FOREIGN KEY ("last_edited_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;
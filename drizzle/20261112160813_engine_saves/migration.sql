CREATE TABLE "canvas"."engine_saves" (
	"user_id" text,
	"project_id" text,
	"slot" text,
	"bytes" integer NOT NULL,
	"game_version" integer NOT NULL,
	"release_id" text,
	"meta" jsonb NOT NULL,
	"written_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "engine_saves_pkey" PRIMARY KEY("user_id","project_id","slot"),
	CONSTRAINT "engine_saves_slot" CHECK ("slot" ~ '^[a-z0-9][a-z0-9-]{0,31}$')
);
--> statement-breakpoint
CREATE INDEX "engine_saves_used_at_idx" ON "canvas"."engine_saves" ("used_at");--> statement-breakpoint
CREATE INDEX "engine_saves_user_idx" ON "canvas"."engine_saves" ("user_id");--> statement-breakpoint
ALTER TABLE "canvas"."engine_saves" ADD CONSTRAINT "engine_saves_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."engine_saves" ADD CONSTRAINT "engine_saves_project_id_engine_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "canvas"."engine_projects"("project_id") ON DELETE CASCADE;
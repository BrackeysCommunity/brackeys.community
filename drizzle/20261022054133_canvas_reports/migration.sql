CREATE TABLE "canvas"."canvas_reports" (
	"id" bigserial PRIMARY KEY,
	"canvas_id" text,
	"canvas_title" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text
);
--> statement-breakpoint
CREATE INDEX "canvas_reports_open_idx" ON "canvas"."canvas_reports" ("canvas_id") WHERE "resolved_at" IS NULL;--> statement-breakpoint
ALTER TABLE "canvas"."canvas_reports" ADD CONSTRAINT "canvas_reports_canvas_id_canvases_id_fkey" FOREIGN KEY ("canvas_id") REFERENCES "canvas"."canvases"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canvas"."canvas_reports" ADD CONSTRAINT "canvas_reports_reporter_id_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canvas"."canvas_reports" ADD CONSTRAINT "canvas_reports_resolved_by_id_user_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;
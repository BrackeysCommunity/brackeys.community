CREATE TABLE "social"."entry_flags" (
	"id" bigserial PRIMARY KEY,
	"entry_id" bigint NOT NULL,
	"jam_id" integer NOT NULL,
	"kind" text NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"score" real,
	"evidence" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itch"."entry_scans" (
	"entry_id" bigint PRIMARY KEY,
	"cover_url" text,
	"cover_phash" text,
	"nsfw_score" real,
	"detector_version" integer NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "entry_flags_open_kind_uidx" ON "social"."entry_flags" ("entry_id","kind") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "entry_flags_entry_idx" ON "social"."entry_flags" ("entry_id");--> statement-breakpoint
CREATE INDEX "entry_flags_jam_idx" ON "social"."entry_flags" ("jam_id");--> statement-breakpoint
CREATE INDEX "entry_scans_cover_phash_idx" ON "itch"."entry_scans" ("cover_phash");--> statement-breakpoint
ALTER TABLE "social"."entry_flags" ADD CONSTRAINT "entry_flags_entry_id_jam_entries_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "itch"."jam_entries"("entry_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."entry_flags" ADD CONSTRAINT "entry_flags_jam_id_jams_jam_id_fkey" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams"("jam_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social"."entry_flags" ADD CONSTRAINT "entry_flags_resolved_by_id_user_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "itch"."entry_scans" ADD CONSTRAINT "entry_scans_entry_id_jam_entries_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "itch"."jam_entries"("entry_id") ON DELETE CASCADE;
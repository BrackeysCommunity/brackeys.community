CREATE TABLE "user"."jam_watches" (
	"user_id" text,
	"jam_id" integer,
	"intent" text DEFAULT 'watching' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"start_notified_at" timestamp,
	"voting_notified_at" timestamp,
	"results_notified_at" timestamp,
	CONSTRAINT "jam_watches_pkey" PRIMARY KEY("user_id","jam_id")
);
--> statement-breakpoint
CREATE INDEX "jam_watches_jam_idx" ON "user"."jam_watches" ("jam_id");--> statement-breakpoint
ALTER TABLE "user"."jam_watches" ADD CONSTRAINT "jam_watches_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user"."jam_watches" ADD CONSTRAINT "jam_watches_jam_id_jams_jam_id_fkey" FOREIGN KEY ("jam_id") REFERENCES "itch"."jams"("jam_id") ON DELETE CASCADE;
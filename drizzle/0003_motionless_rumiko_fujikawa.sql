CREATE TABLE "profile_url_stubs" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"stub" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profile_url_stubs_profile_id_unique" UNIQUE("profile_id"),
	CONSTRAINT "profile_url_stubs_stub_unique" UNIQUE("stub")
);
--> statement-breakpoint
ALTER TABLE "profile_url_stubs" ADD CONSTRAINT "profile_url_stubs_profile_id_developer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."developer_profiles"("id") ON DELETE cascade ON UPDATE no action;
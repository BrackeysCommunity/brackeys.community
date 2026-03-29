CREATE TABLE "user"."linked_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_username" text,
	"provider_avatar_url" text,
	"provider_profile_url" text,
	"access_token" text,
	"scopes" text,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "linked_accounts_profile_id_provider_unique" UNIQUE("profile_id","provider")
);
--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "user"."profile_projects" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "user"."linked_accounts" ADD CONSTRAINT "linked_accounts_profile_id_developer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "user"."developer_profiles"("id") ON DELETE cascade ON UPDATE no action;
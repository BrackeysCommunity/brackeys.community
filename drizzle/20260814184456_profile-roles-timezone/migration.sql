CREATE TABLE "user"."user_roles" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"role_id" integer NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_unique" UNIQUE("user_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "user"."developer_profiles" ADD COLUMN "location" text;--> statement-breakpoint
CREATE INDEX "developer_profiles_timezone_idx" ON "user"."developer_profiles" ("timezone");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user"."user_roles" ("role_id");--> statement-breakpoint
ALTER TABLE "user"."user_roles" ADD CONSTRAINT "user_roles_user_id_developer_profiles_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"."developer_profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user"."user_roles" ADD CONSTRAINT "user_roles_role_id_collab_roles_id_fkey" FOREIGN KEY ("role_id") REFERENCES "collab"."collab_roles"("id") ON DELETE CASCADE;
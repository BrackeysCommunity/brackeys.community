-- Create "notifications" table
CREATE TABLE "user"."notifications" (
  "id" bigserial NOT NULL,
  "user_id" text NOT NULL,
  "type" text NOT NULL,
  "actor_id" text NULL,
  "entity_type" text NULL,
  "entity_id" text NULL,
  "data" jsonb NOT NULL DEFAULT '{}',
  "read_at" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "notifications_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "auth"."user" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "notifications_user_created_idx" to table: "notifications"
CREATE INDEX "notifications_user_created_idx" ON "user"."notifications" ("user_id", "created_at" DESC NULLS LAST);
-- Create index "notifications_user_unread_idx" to table: "notifications"
CREATE INDEX "notifications_user_unread_idx" ON "user"."notifications" ("user_id", "created_at" DESC NULLS LAST) WHERE (read_at IS NULL);

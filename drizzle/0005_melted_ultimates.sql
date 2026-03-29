CREATE SCHEMA "collab";
--> statement-breakpoint
CREATE TABLE "collab"."collab_post_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"strapi_media_id" text NOT NULL,
	"url" text NOT NULL,
	"alt" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_post_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_post_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"role_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"project_name" text,
	"compensation" text,
	"team_size" text,
	"project_length" text,
	"platforms" text[],
	"experience" text,
	"portfolio_url" text,
	"contact_method" text,
	"status" text DEFAULT 'recruiting' NOT NULL,
	"featured_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"responder_id" text NOT NULL,
	"message" text NOT NULL,
	"portfolio_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "collab_responses_post_id_responder_id_unique" UNIQUE("post_id","responder_id")
);
--> statement-breakpoint
CREATE TABLE "collab"."collab_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	CONSTRAINT "collab_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "collab"."collab_post_images" ADD CONSTRAINT "collab_post_images_post_id_collab_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_reports" ADD CONSTRAINT "collab_post_reports_post_id_collab_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_reports" ADD CONSTRAINT "collab_post_reports_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_roles" ADD CONSTRAINT "collab_post_roles_post_id_collab_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_post_roles" ADD CONSTRAINT "collab_post_roles_role_id_collab_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "collab"."collab_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_posts" ADD CONSTRAINT "collab_posts_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_responses" ADD CONSTRAINT "collab_responses_post_id_collab_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "collab"."collab_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab"."collab_responses" ADD CONSTRAINT "collab_responses_responder_id_user_id_fk" FOREIGN KEY ("responder_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;
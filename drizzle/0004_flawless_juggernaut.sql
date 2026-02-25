CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "hammer";
--> statement-breakpoint
CREATE SCHEMA "user";
--> statement-breakpoint
ALTER TABLE "public"."account" SET SCHEMA "auth";
--> statement-breakpoint
ALTER TABLE "public"."alt_accounts" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."blocked_reporters" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."deleted_messages" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."developer_profiles" SET SCHEMA "user";
--> statement-breakpoint
ALTER TABLE "public"."infractions" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."jam_participations" SET SCHEMA "user";
--> statement-breakpoint
ALTER TABLE "public"."member_notes" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."mutes" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."profile_projects" SET SCHEMA "user";
--> statement-breakpoint
ALTER TABLE "public"."profile_url_stubs" SET SCHEMA "user";
--> statement-breakpoint
ALTER TABLE "public"."reported_messages" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."rules" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."session" SET SCHEMA "auth";
--> statement-breakpoint
ALTER TABLE "public"."skill_requests" SET SCHEMA "user";
--> statement-breakpoint
ALTER TABLE "public"."skills" SET SCHEMA "user";
--> statement-breakpoint
ALTER TABLE "public"."staff_messages" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."temporary_bans" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."tracked_messages" SET SCHEMA "hammer";
--> statement-breakpoint
ALTER TABLE "public"."user" SET SCHEMA "auth";
--> statement-breakpoint
ALTER TABLE "public"."user_skills" SET SCHEMA "user";
--> statement-breakpoint
ALTER TABLE "public"."verification" SET SCHEMA "auth";

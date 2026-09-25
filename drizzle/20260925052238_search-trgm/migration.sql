CREATE INDEX "collab_posts_title_trgm_idx" ON "collab"."collab_posts" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "developer_profiles_guild_nickname_trgm_idx" ON "user"."developer_profiles" USING gin (public.f_unaccent("guild_nickname") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "developer_profiles_discord_username_trgm_idx" ON "user"."developer_profiles" USING gin (public.f_unaccent("discord_username") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "developer_profiles_discord_handle_trgm_idx" ON "user"."developer_profiles" USING gin (public.f_unaccent("discord_handle") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "jam_entries_game_title_trgm_idx" ON "itch"."jam_entries" USING gin ("game_title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "jams_title_trgm_idx" ON "itch"."jams" USING gin (public.f_unaccent("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "jams_hashtag_trgm_idx" ON "itch"."jams" USING gin ("hashtag" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "profile_url_stubs_stub_trgm_idx" ON "user"."profile_url_stubs" USING gin (public.f_unaccent("stub") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "teams_name_trgm_idx" ON "team"."teams" USING gin (public.f_unaccent("name") gin_trgm_ops);
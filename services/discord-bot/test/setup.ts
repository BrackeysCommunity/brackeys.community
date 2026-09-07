// Unit tests never open a gateway connection or call the API, but config.ts
// refuses to parse without the Discord credentials — stub them in.
process.env.DISCORD_BOT_TOKEN ??= "test-token";
process.env.DISCORD_APPLICATION_ID ??= "100000000000000001";
process.env.DISCORD_GUILD_ID ??= "100000000000000002";
process.env.APP_URL ??= "https://brackeys.test";

package gateway

// The Activity listener's settings.
const (
	EnvPort         = "MMO_ACTIVITY_PORT"     // unset: no Activity listener
	EnvDir          = "MMO_ACTIVITY_DIR"      // the Activity's static build
	EnvDev          = "MMO_ACTIVITY_DEV"      // 1: sign in by naming a Discord user; honoured only on a disposable world
	EnvDiscordAPI   = "MMO_DISCORD_API"       // Discord's API base, so a test can fake it
	EnvAppID        = "DISCORD_APP_ID"        // the application the Activity belongs to
	EnvClientSecret = "DISCORD_CLIENT_SECRET" // unset once read, never logged or stored
)

// DiscordAPI is where Discord's API is when nothing says otherwise.
const DiscordAPI = "https://discord.com/api"

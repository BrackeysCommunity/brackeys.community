package gateway

import (
	"fmt"
	"log/slog"
	"math"
	"net/url"
	"os"

	"jams.team/mmo-world/internal/envvar"
)

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

// FromEnv reads the Activity listener's settings; port is "" when none is
// asked for. Discord's client secret is unset once read and comes back in
// needles, even with an error, so the log guard can keep it out. A world
// players keep needs the application's credentials; only a disposable
// one signs in without Discord.
func FromEnv(apiPort string, manual, disposable bool, log *slog.Logger) (cfg Config, port string, needles []string, err error) {
	cfg = Config{AppID: os.Getenv(EnvAppID), ClientSecret: os.Getenv(EnvClientSecret), DiscordAPI: os.Getenv(EnvDiscordAPI),
		Dir: os.Getenv(EnvDir), Log: log}
	_ = os.Unsetenv(EnvClientSecret)
	if s := cfg.ClientSecret; s != "" {
		needles = []string{s, url.QueryEscape(s)}
	}
	port = os.Getenv(EnvPort)
	if port != "" {
		if _, err := envvar.Number(EnvPort, "", 1, math.MaxUint16); err != nil {
			return cfg, "", needles, err
		}
		if port == apiPort {
			return cfg, "", needles, fmt.Errorf("%s must not be the API's port: the Activity's listener is public", EnvPort)
		}
		if (cfg.AppID == "" || cfg.ClientSecret == "") && !manual && !disposable {
			return cfg, "", needles, fmt.Errorf("%s needs %s and %s on a world players keep", EnvPort, EnvAppID, EnvClientSecret)
		}
	}
	cfg.Dev = os.Getenv(EnvDev) == "1"
	if cfg.Dev && !disposable {
		log.Warn(EnvDev + " is ignored: only a disposable world signs in without Discord")
		cfg.Dev = false
	}
	return cfg, port, needles, nil
}

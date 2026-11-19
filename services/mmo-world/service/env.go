package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"os"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

// A world's identity, keys and storage: read by the service and op replay.
const (
	EnvMaster     = "MMO_MASTER_SECRET" // base64; unset once read, never logged or stored
	EnvWorld      = "MMO_WORLD_ID"
	EnvEpoch      = "MMO_ROLL_EPOCH"
	EnvKeyVersion = "MMO_KEY_VERSION"
	EnvSheets     = "MMO_SHEETS_ROOT" // the directory holding sheets/ and packs/; the working directory when unset
	EnvDatabase   = "DATABASE_URL"
)

// Service and operator settings.
const (
	EnvTickSeconds   = "MMO_TICK_SECONDS"
	EnvPollMS        = "MMO_POLL_MS"
	EnvPort          = "PORT"
	EnvLogLevel      = "LOG_LEVEL"
	EnvAPIToken      = "MMO_API_TOKEN" // required unless the world is disposable or on the manual clock
	EnvOperatorToken = "MMO_OPERATOR_TOKEN"
	EnvManualClock   = "MMO_MANUAL_CLOCK" // tests only: the due tick is set through the operator API
	EnvDisposable    = "MMO_DISPOSABLE"   // 1: found worlds that may be wiped; never on a world players keep
	EnvPosthogKey    = "POSTHOG_KEY"
	EnvPosthogHost   = "POSTHOG_HOST"
	EnvURL           = "MMO_URL" // where the operator CLI finds the service
)

// Secrets are a world's identity and keys, from the environment. Epoch and
// KeyVersion fit the world row's int32 columns.
type Secrets struct {
	World      string
	Epoch      int32
	KeyVersion int32
	Keys       keys.Set
	// Needles are every text form of the master and the keys, for the
	// log guard and the start-up check.
	Needles []string
}

// Getenv reads a variable with a fallback.
func Getenv(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

// Number reads a whole-number variable with a fallback, within [lo, hi].
func Number(name, fallback string, lo, hi int64) (int64, error) {
	n, err := strconv.ParseInt(Getenv(name, fallback), 10, 64)
	if err != nil || n < lo || n > hi {
		return 0, fmt.Errorf("%s must be a whole number from %d to %d", name, lo, hi)
	}
	return n, nil
}

// BookFromEnv loads the sheets under the sheets root.
func BookFromEnv() (*sheets.Book, error) {
	return sheetfs.LoadBook(Getenv(EnvSheets, "."))
}

// PoolFromEnv opens the database.
func PoolFromEnv(ctx context.Context) (*pgxpool.Pool, error) {
	return pgxpool.New(ctx, os.Getenv(EnvDatabase))
}

// SecretsFromEnv derives the keys and forgets the master.
func SecretsFromEnv() (Secrets, error) {
	master, err := base64.StdEncoding.DecodeString(os.Getenv(EnvMaster))
	_ = os.Unsetenv(EnvMaster)
	defer clear(master)
	if err != nil || len(master) == 0 {
		return Secrets{}, errors.New(EnvMaster + " must be set to a base64 secret")
	}
	s := Secrets{World: os.Getenv(EnvWorld)}
	if s.World == "" {
		return Secrets{}, errors.New(EnvWorld + " must be set")
	}
	e, err := Number(EnvEpoch, "", math.MinInt32, math.MaxInt32)
	if err != nil {
		return Secrets{}, err
	}
	s.Epoch = int32(e)
	v, err := Number(EnvKeyVersion, "1", 0, math.MaxInt32)
	if err != nil {
		return Secrets{}, err
	}
	s.KeyVersion = int32(v)
	if s.Keys, err = keys.Derive(master, s.World, int64(s.Epoch)); err != nil {
		return Secrets{}, err
	}
	s.Needles = keys.Needles(master, s.Keys)
	return s, nil
}

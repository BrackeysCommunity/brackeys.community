package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/internal/envvar"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

// A world's identity, keys and storage: read by the service and op replay.
const (
	EnvMaster     = "MMO_MASTER_SECRET" // base64; unset once read, never logged or stored
	EnvWorld      = "MMO_WORLD_ID"
	EnvEpoch      = "MMO_ROLL_EPOCH"
	EnvEpochNext  = "MMO_ROLL_EPOCH_NEXT" // the roll epoch the next rules epoch steps to, its key derived before the master goes
	EnvKeyVersion = "MMO_KEY_VERSION"
	EnvSheets     = "MMO_SHEETS_ROOT" // the directory holding sheets/ and packs/; the working directory when unset
	EnvDatabase   = "DATABASE_URL"
)

// Service and operator settings. A token setting holds one token, or
// "new,old" while rotating (Tokens).
const (
	EnvTickSeconds   = "MMO_TICK_SECONDS"
	EnvPollMS        = "MMO_POLL_MS"
	EnvPort          = "PORT"
	EnvLogLevel      = "LOG_LEVEL"
	EnvAPIToken      = "MMO_API_TOKEN" // required unless the world is disposable or on the manual clock
	EnvOperatorToken = "MMO_OPERATOR_TOKEN"
	EnvMapToken      = "MMO_MAP_TOKEN"    // reads only the live map's paths; the API token reads them too
	EnvForgetToken   = "MMO_FORGET_TOKEN" // opens only the forget path, for the site's account deletion
	EnvManualClock   = "MMO_MANUAL_CLOCK" // tests only: the due tick is set through the operator API
	EnvDisposable    = "MMO_DISPOSABLE"   // 1: found worlds that may be wiped; never on a world players keep
	EnvSheetsFrom    = "MMO_SHEETS_FROM"  // a kept world's old sheets digest: re-stamp it onto these sheets, once
	EnvSheetsNext    = "MMO_SHEETS_NEXT"  // a sheets root whose book the world takes at its next season's close
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
	// NextEpoch is the roll epoch a pending rules epoch steps to, and
	// NextKeys the keys under it; nil when the roll key does not step.
	NextEpoch *int32
	NextKeys  keys.Set
	// Needles are every text form of the master and the keys, for the
	// log guard and the start-up check.
	Needles []string
}

// BookFromEnv loads the sheets under the sheets root.
func BookFromEnv() (*sheets.Book, error) {
	return sheetfs.LoadBook(envvar.Get(EnvSheets, "."))
}

// NextBookFromEnv loads the pending book of a rules epoch, if one is
// staged.
func NextBookFromEnv() (*sheets.Book, error) {
	root := os.Getenv(EnvSheetsNext)
	if root == "" {
		return nil, nil
	}
	b, err := sheetfs.LoadBook(root)
	if err != nil {
		return nil, fmt.Errorf("service: the pending sheets under %s: %w", EnvSheetsNext, err)
	}
	return b, nil
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
	e, err := envvar.Number(EnvEpoch, "", math.MinInt32, math.MaxInt32)
	if err != nil {
		return Secrets{}, err
	}
	s.Epoch = int32(e)
	v, err := envvar.Number(EnvKeyVersion, "1", 0, math.MaxInt32)
	if err != nil {
		return Secrets{}, err
	}
	s.KeyVersion = int32(v)
	if s.Keys, err = keys.Derive(master, s.World, int64(s.Epoch)); err != nil {
		return Secrets{}, err
	}
	s.Needles = keys.Needles(master, s.Keys)
	if os.Getenv(EnvEpochNext) == "" {
		return s, nil
	}
	n, err := envvar.Number(EnvEpochNext, "", math.MinInt32, math.MaxInt32)
	if err != nil {
		return Secrets{}, err
	}
	next := int32(n)
	if s.NextKeys, err = keys.Derive(master, s.World, int64(next)); err != nil {
		return Secrets{}, err
	}
	s.NextEpoch = &next
	have := map[string]bool{}
	for _, x := range s.Needles {
		have[x] = true
	}
	for _, x := range keys.Needles(master, s.NextKeys) {
		if !have[x] {
			have[x] = true
			s.Needles = append(s.Needles, x)
		}
	}
	return s, nil
}

// Tokens are the bearer tokens a token setting lists: one, or "new,old"
// while rotating. Empty entries are dropped.
func Tokens(v string) [][]byte {
	var out [][]byte
	for _, t := range strings.Split(v, ",") {
		if t = strings.TrimSpace(t); t != "" {
			out = append(out, []byte(t))
		}
	}
	return out
}

// TokenFromEnv is the token a client sends from a token setting: the
// first listed, the new one while rotating.
func TokenFromEnv(name string) string {
	if ts := Tokens(os.Getenv(name)); len(ts) > 0 {
		return string(ts[0])
	}
	return ""
}

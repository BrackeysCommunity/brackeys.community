package service

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strconv"

	"jams.team/mmo-world/sim/keys"
)

// The master secret arrives base64-encoded in the environment and goes no
// further than the process that reads it: it is unset once read, never
// logged, never stored.
const (
	EnvMaster     = "MMO_MASTER_SECRET"
	EnvWorld      = "MMO_WORLD_ID"
	EnvEpoch      = "MMO_ROLL_EPOCH"
	EnvKeyVersion = "MMO_KEY_VERSION"
	EnvSheets     = "MMO_SHEETS_ROOT" // the directory holding sheets/ and packs/; the working directory when unset
	EnvDatabase   = "DATABASE_URL"
)

// Secrets are a world's identity and keys, from the environment.
type Secrets struct {
	World      string
	Epoch      int64
	KeyVersion int64
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

// Number reads a whole-number variable with a fallback.
func Number(name, fallback string) (int64, error) {
	n, err := strconv.ParseInt(Getenv(name, fallback), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be a whole number", name)
	}
	return n, nil
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
	if s.Epoch, err = Number(EnvEpoch, ""); err != nil {
		return Secrets{}, err
	}
	if s.KeyVersion, err = Number(EnvKeyVersion, "1"); err != nil {
		return Secrets{}, err
	}
	if s.Keys, err = keys.Derive(master, s.World, s.Epoch); err != nil {
		return Secrets{}, err
	}
	s.Needles = keys.Needles(master, s.Keys)
	return s, nil
}

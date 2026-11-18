// Package keys derives the world's three secret keys from one master
// secret by HKDF-SHA-256. The master lives only in the world service's
// environment; the database holds a key version, never a key.
//
// Generation and quirk keys are for the life of a world: changing either
// changes everything still undiscovered. The roll key may change at a
// rules epoch, which is why it carries its own version in the info string.
package keys

import (
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/draw"
)

// structural: below 32 bytes the master is weaker than the keys it makes.
const MinMasterBytes = 32

// structural: decimal formatting of the version in the info string.
const base10 = 10

type Set struct {
	Generation draw.Key
	Roll       draw.Key
	Quirk      draw.Key
}

var ErrShortMaster = errors.New("keys: master secret must be at least 32 bytes")

// Derive makes the key set for one world. rollEpoch is the rules epoch the
// roll key belongs to.
func Derive(master []byte, worldID string, rollEpoch int64) (Set, error) {
	if len(master) < MinMasterBytes {
		return Set{}, ErrShortMaster
	}
	var s Set
	for _, k := range []struct {
		dst  *draw.Key
		info string
	}{
		{&s.Generation, "mmo/generation"},
		{&s.Roll, "mmo/roll/epoch-" + strconv.FormatInt(rollEpoch, base10)},
		{&s.Quirk, "mmo/quirk"},
	} {
		out, err := hkdf.Key(sha256.New, master, []byte(worldID), k.info, draw.KeySize)
		if err != nil {
			return Set{}, err
		}
		copy(k.dst[:], out)
	}
	return s, nil
}

// Throwaway is a key set for tests, fixtures and the harness. Its master is
// a public function of the label, so nothing it generates is secret.
func Throwaway(label string) Set {
	m := sha256.Sum256([]byte("mmo/throwaway/" + label))
	s, err := Derive(m[:], "throwaway", 0)
	if err != nil {
		panic(err)
	}
	return s
}

// Check is an HMAC under the generation key that names the key set
// without revealing it: stored with a world, it refuses a service started
// with the wrong master secret.
func (s Set) Check() string {
	m := hmac.New(sha256.New, s.Generation[:])
	m.Write([]byte("mmo/key-check"))
	return hex.EncodeToString(m.Sum(nil))
}

// Needles are the forms a leaked key would take in text: the master and
// each derived key in hex and base64. The start-up check looks for them in
// the database and the log guard in every line written.
func Needles(master []byte, s Set) []string {
	var out []string
	for _, k := range [][]byte{master, s.Generation[:], s.Roll[:], s.Quirk[:]} {
		out = append(out, hex.EncodeToString(k), strings.ToUpper(hex.EncodeToString(k)),
			base64.StdEncoding.EncodeToString(k), base64.RawStdEncoding.EncodeToString(k),
			base64.URLEncoding.EncodeToString(k), base64.RawURLEncoding.EncodeToString(k))
	}
	return out
}

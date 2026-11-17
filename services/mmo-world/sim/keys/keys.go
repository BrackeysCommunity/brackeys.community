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
	"crypto/sha256"
	"errors"
	"strconv"

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

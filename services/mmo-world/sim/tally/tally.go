// Package tally is the sim's general counter: a sorted set of named
// counts, kept by items, characters and fights alike.
package tally

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/tags"
)

// Count is one counter in a Tally.
type Count struct {
	Key string `json:"k"`
	N   int64  `json:"n"`
}

// Tally is a sorted set of counters. Record keys are "event:tag"; every
// Add also counts "event:any".
type Tally []Count

func (t Tally) Get(key string) int64 {
	i, ok := slices.BinarySearchFunc(t, key, func(c Count, k string) int { return cmp.Compare(c.Key, k) })
	if !ok {
		return 0
	}
	return t[i].N
}

func (t *Tally) Bump(key string, n int64) {
	i, ok := slices.BinarySearchFunc(*t, key, func(c Count, k string) int { return cmp.Compare(c.Key, k) })
	if ok {
		(*t)[i].N += n
		return
	}
	*t = slices.Insert(*t, i, Count{Key: key, N: n})
}

// Add counts an event once under "event:any" and once per tag.
func (t *Tally) Add(event string, ts ...tags.Tag) {
	t.Bump(event+":any", 1)
	for _, x := range ts {
		t.Bump(event+":"+string(x), 1)
	}
}

// Score sums the counters a list of record keys names.
func (t Tally) Score(keys []string) int64 {
	var s int64
	for _, k := range keys {
		s += t.Get(k)
	}
	return s
}

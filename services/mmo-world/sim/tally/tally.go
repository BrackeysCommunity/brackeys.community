// Package tally keeps sorted, named event counts.
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

// Tally is a set of counters kept sorted by key; a literal or decoded Tally
// must already be sorted.
type Tally []Count

func (t Tally) find(key string) (int, bool) {
	return slices.BinarySearchFunc(t, key, func(c Count, k string) int { return cmp.Compare(c.Key, k) })
}

// Get is key's count, 0 when absent.
func (t Tally) Get(key string) int64 {
	i, ok := t.find(key)
	if !ok {
		return 0
	}
	return t[i].N
}

// Bump adds n to key's count.
func (t *Tally) Bump(key string, n int64) {
	i, ok := t.find(key)
	if ok {
		(*t)[i].N += n
		return
	}
	*t = slices.Insert(*t, i, Count{Key: key, N: n})
}

// Key is the counter name of event under tag t.
func Key(event string, t tags.Tag) string { return event + ":" + string(t) }

// Add counts an event once under "event:any" and once per tag.
func (t *Tally) Add(event string, ts ...tags.Tag) {
	t.Bump(Key(event, "any"), 1)
	t.Each(event, ts...)
}

// Each counts an event once per tag.
func (t *Tally) Each(event string, ts ...tags.Tag) {
	for _, x := range ts {
		t.Bump(Key(event, x), 1)
	}
}

// Score sums the counts at keys.
func (t Tally) Score(keys []string) int64 {
	var s int64
	for _, k := range keys {
		s += t.Get(k)
	}
	return s
}

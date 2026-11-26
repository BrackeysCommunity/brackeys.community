package mapview

import (
	"maps"
	"slices"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
)

// Record is a last-seen record: the live layers as the holder last saw
// them and the tick the tile left sight.
type Record struct {
	Holder Holder
	Hex    hex.Hex
	Left   int64
	Live   api.MapLive // Fog seen, Left set
}

// Change is one holder's pass result: its new key and the tiles that left
// its sight, recorded.
type Change struct {
	Holder Holder
	Key    Key
	Seen   []Record
}

// Pass compares the keys now with prev for the holders named (nil: all)
// and returns each change, and the holders gone. Only a holder whose key
// changed is in changes; one with no key in prev is keyed with no
// records. Its records are the tiles in its old sight and not its new,
// with their values as they are now. Pass reads no tile set for a holder
// whose key is unchanged, so its cost follows movement, not map size.
func Pass(g *game.Game, prev map[Holder]Key, only []Holder, p Params) (changes []Change, gone []Holder) {
	var now map[Holder]Key
	holders := only
	if holders == nil {
		now = Keys(g)
		seen := maps.Clone(now)
		for h := range prev {
			seen[h] = nil
		}
		holders = slices.Collect(maps.Keys(seen))
	}
	holders = slices.Clone(holders)
	slices.SortFunc(holders, compareHolders)
	holders = slices.Compact(holders)
	tick := g.Tick()
	for _, h := range holders {
		k, ok := now[h]
		if !ok {
			k, ok = KeyOf(g, h)
		}
		old, had := prev[h]
		if !ok {
			if had {
				gone = append(gone, h)
			}
			continue
		}
		if had && slices.Equal(old, k) {
			continue
		}
		c := Change{Holder: h, Key: k}
		if had {
			c.Seen = leaving(g, h, old, k, tick, p)
		}
		changes = append(changes, c)
	}
	return changes, gone
}

// leaving are the records of the tiles in old's set and not in k's.
func leaving(g *game.Game, h Holder, old, k Key, tick int64, p Params) []Record {
	stay := map[hex.Hex]bool{}
	cover(g, k, stay)
	var out []Record
	for _, x := range Set(g, old) {
		if stay[x] {
			continue
		}
		live := Live(g, x, p)
		live.Fog, live.Left = api.FogSeen, tick
		out = append(out, Record{Holder: h, Hex: x, Left: tick, Live: live})
	}
	return out
}

// MemSeen keeps records in memory, for the Local world and the harness.
// Its zero value is empty and ready.
type MemSeen struct {
	mu sync.Mutex
	by map[Holder]map[hex.Hex]Record
	n  int
}

// Apply writes a pass: each change's records over the holder's old ones
// for those tiles, and the gone holders' records dropped.
func (m *MemSeen) Apply(changes []Change, gone []Holder) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.by == nil {
		m.by = map[Holder]map[hex.Hex]Record{}
	}
	for _, c := range changes {
		if len(c.Seen) == 0 {
			continue
		}
		recs := m.by[c.Holder]
		if recs == nil {
			recs = map[hex.Hex]Record{}
			m.by[c.Holder] = recs
		}
		for _, r := range c.Seen {
			if _, ok := recs[r.Hex]; !ok {
				m.n++
			}
			recs[r.Hex] = r
		}
	}
	for _, h := range gone {
		m.n -= len(m.by[h])
		delete(m.by, h)
	}
}

// In are the holders' records in some chunks, holder by holder in the
// order given, each sorted by r, then q.
func (m *MemSeen) In(holders []Holder, chunks []gen.ChunkCoord, chunkOf func(hex.Hex) gen.ChunkCoord) []Record {
	m.mu.Lock()
	defer m.mu.Unlock()
	want := map[gen.ChunkCoord]bool{}
	for _, c := range chunks {
		want[c] = true
	}
	var out []Record
	for _, h := range holders {
		recs := m.by[h]
		for _, x := range slices.SortedFunc(maps.Keys(recs), byRQ) {
			if want[chunkOf(x)] {
				out = append(out, recs[x])
			}
		}
	}
	return out
}

// Count is how many records are kept.
func (m *MemSeen) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.n
}

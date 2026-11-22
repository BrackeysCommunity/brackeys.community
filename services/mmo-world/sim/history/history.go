// Package history summarises what happened round a tile into a digest of
// fixed size, which a tile's content is drawn from at its first reach
// (GDD 4.17). It is a leaf: the world indexes the facts and calls in.
package history

import (
	"cmp"
	"maps"
	"slices"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// PinKinds is the prefix of the pin facts, which no digest counts: a pin
// reaches later tiles only through its own reach.
const PinKinds = sheets.PinKinds

// Heavy is one indexed fact.
type Heavy struct {
	ID     int64   `json:"id"`
	Kind   string  `json:"kind"`
	Tick   int64   `json:"tick"`
	Weight int64   `json:"weight"`
	At     hex.Hex `json:"at"`
}

// Count is how many of a kind lay within reach.
type Count struct {
	Kind string `json:"kind"`
	N    int64  `json:"n"`
}

// Pressure is what the factions holding regions within reach bring.
type Pressure struct {
	Holders    int64    `json:"holders,omitempty"`
	Archetypes []string `json:"archetypes,omitempty"`
	War        bool     `json:"war,omitempty"`
	Starving   bool     `json:"starving,omitempty"`
}

// Digest is a tile's neighbourhood when its content was drawn (GDD 4.17).
// It is the same size however much has happened.
type Digest struct {
	Facts   []Count  `json:"facts,omitempty"` // by kind, sorted, N ≤ history-kind-most
	Bands   []int64  `json:"bands,omitempty"` // per world.gauges row, the tile's region
	Faction Pressure `json:"faction"`
	Pins    []string `json:"pins,omitempty"`  // sorted, ≤ pins-in-reach-max
	Finds   []Count  `json:"finds,omitempty"` // by find kind, regions touching the disc
}

// Bounds are the map.params cells a digest is read under.
type Bounds struct{ Weight, Radius, Ticks, CellKept, KindMost, HoldersMost, PinsMost, PinsPerCell int64 }

// BoundsOf reads the bounds from map.params.
func BoundsOf(mapParams []sheets.Param) Bounds {
	p := func(id string) int64 { return sheets.IntParam(mapParams, id) }
	return Bounds{
		Weight:      p("history-weight"),
		Radius:      p("history-radius"),
		Ticks:       p("history-days") * sheets.TicksPerDay,
		CellKept:    p("history-cell-kept"),
		KindMost:    p("history-kind-most"),
		HoldersMost: p("history-holders-most"),
		PinsMost:    p("pins-in-reach-max"),
		PinsPerCell: p("pins-per-cell"),
	}
}

// FindKinds is how many kinds of find a digest counts.
var FindKinds = int64(len(sheets.FindKindIDs()))

// structural: CellsRead is the 3 × 3 index cells a digest reads round its own.
const CellsRead = 9

// CostBound is the most a digest may visit: the disc, and per cell read its
// kept facts, its pins and the find kinds of one region.
func (b Bounds) CostBound() int64 {
	return hex.DiscSize(b.Radius) + CellsRead*(b.CellKept+b.PinsPerCell+FindKinds)
}

// Indexed reports whether a fact of this kind and weight belongs in the
// index at all.
func (b Bounds) Indexed(kind string, weight int64) bool {
	return sheets.Indexed(kind, weight, b.Weight)
}

// CellOf is the index cell holding h: cells are Radius by Radius axial
// tiles, so a disc of Radius lies inside the 3 × 3 cells round its own.
func (b Bounds) CellOf(h hex.Hex) (i, j int64) {
	return hex.FloorDiv(h.Q, b.Radius), hex.FloorDiv(h.R, b.Radius)
}

// Facts counts the indexed entries within b.Radius of at with
// now−b.Ticks ≤ Tick < now, by kind, capped at b.KindMost. An entry passed
// twice counts once, so overlapping cells cannot inflate a count.
func Facts(at hex.Hex, now int64, b Bounds, cells ...[]Heavy) []Count {
	seen := map[int64]bool{}
	n := map[string]int64{}
	for _, cell := range cells {
		for _, e := range cell {
			if seen[e.ID] || !b.Indexed(e.Kind, e.Weight) || e.Tick >= now || e.Tick < now-b.Ticks ||
				hex.Distance(e.At, at) > b.Radius {
				continue
			}
			seen[e.ID] = true
			n[e.Kind]++
		}
	}
	return Tally(n, b.KindMost)
}

// Tally turns counts by kind into a digest's sorted list, each capped at
// most; a zero count is dropped.
func Tally(n map[string]int64, most int64) []Count {
	var out []Count
	for _, kind := range slices.Sorted(maps.Keys(n)) {
		if c := n[kind]; c > 0 {
			out = append(out, Count{Kind: kind, N: min(c, most)})
		}
	}
	return out
}

// BandOf is how many distinct atLeast values of the gauge's lines sit at
// or below value: the steps that matter, not the daily wobble.
func BandOf(lines []sheets.GaugeLine, gauge string, value int64) int64 {
	var n int64
	for _, at := range sheets.BandLines(lines, gauge) {
		if at <= value {
			n++
		}
	}
	return n
}

// Key is the digest's part in every content draw.
func (d Digest) Key() string {
	s, err := canon.Digest(d)
	if err != nil {
		panic("history: " + err.Error())
	}
	return s.String()
}

// Count is how many facts of a kind the digest holds.
func (d Digest) Count(kind string) int64 { return countOf(d.Facts, kind) }

// Found is how many finds of a kind the digest holds.
func (d Digest) Found(kind string) int64 { return countOf(d.Finds, kind) }

// Band is the tile's region's band on the gauge at that index of
// world.gauges; 0 when the digest holds none.
func (d Digest) Band(gauge int) int64 {
	if gauge < 0 || gauge >= len(d.Bands) {
		return 0
	}
	return d.Bands[gauge]
}

func countOf(cs []Count, kind string) int64 {
	if i, ok := slices.BinarySearchFunc(cs, kind, func(c Count, k string) int { return cmp.Compare(c.Kind, k) }); ok {
		return cs[i].N
	}
	return 0
}

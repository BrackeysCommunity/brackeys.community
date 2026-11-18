// Package gen answers what any tile of an endless world is before anyone
// touches it: patterns first, then layered noise around them, the spine
// and corridors that keep everything reachable, rivers, regions and
// sites. Every answer is a pure function of the generation key, the map
// sheets and a bounded neighbourhood of the tile, so chunks can be
// generated in any order and nothing is stored (GDD 4.2, 4.13, 4.17).
package gen

import "jams.team/mmo-world/sim/hex"

// Hex is an axial coordinate (sim/hex).
type Hex = hex.Hex

// structural: the grid's own numbers, mirrored from sim/hex.
const (
	discSides = 3
	halves    = 2
	nDirs     = hex.Directions
)

func Distance(a, b Hex) int64               { return hex.Distance(a, b) }
func Ring(centre Hex, radius int64) []Hex   { return hex.Ring(centre, radius) }
func Disc(radius int64) []Hex               { return hex.Disc(radius) }
func DiscAt(centre Hex, radius int64) []Hex { return hex.DiscAt(centre, radius) }
func DiscSize(radius int64) int64           { return hex.DiscSize(radius) }
func Line(a, b Hex) []Hex                   { return hex.Line(a, b) }
func Directions() int                       { return nDirs }
func direction(d int) Hex                   { return hex.Direction(d) }
func divRound(x, n int64) int64             { return hex.DivRound(x, n) }
func floorDiv(a, b int64) int64             { return hex.FloorDiv(a, b) }

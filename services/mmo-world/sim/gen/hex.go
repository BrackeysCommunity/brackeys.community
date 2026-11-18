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

// structural: halving, thirding (a disc's three sides, a triangle's
// centroid), and the grid's directions.
const (
	discSides = 3
	halves    = 2
	nDirs     = hex.Directions
)

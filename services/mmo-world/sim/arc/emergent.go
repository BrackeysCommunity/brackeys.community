package arc

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

// Emergent is what the emergence predicates read beyond World and Extra
// (GDD 13). A World without it casts none of them, and its troubles and
// occasions read World and Extra alone.
type Emergent interface {
	// RoadLoad is the load carried onto region's road tiles over
	// road-war-days, and its busiest road tile; ok is false with no road.
	RoadLoad(region int) (load int64, busiest hex.Hex, ok bool)
	// Raider is a faction not holding region that holds one within reach
	// of its busiest road tile.
	Raider(region int) (faction int, ok bool)
	// Caravans are the live caravans.
	Caravans() []CaravanView
	// RoadCut reports a road within road-in-reach of place, every tile of it cut.
	RoadCut(place int) bool
	// RoadIn reports an open road within road-in-reach of place, or a route's end.
	RoadIn(place int) bool
	// Legends are the newest legends-kept legends not laid to rest.
	Legends() []LegendView
	// Contests are the opposed goals not yet cast.
	Contests() []ContestView
}

// CaravanView is one live caravan.
type CaravanView struct {
	ID     string
	At     hex.Hex
	Ahead  []int // regions it has still to cross, in order
	To     int
	Halted bool
}

// LegendView is one unlaid legend.
type LegendView struct {
	ID     string
	Region int
	At     hex.Hex
	Rested bool // cast within legend-rest-days
}

// ContestView is two First-mode goals racing for one thing in a region.
type ContestView struct {
	A, B         string
	SeatA, SeatB int
	Region       int
	Tag          string
}

// Cast kinds the emergence templates bind.
const (
	KindCaravan = "caravan"
	KindLegend  = "legend"
)

// Roles the emergence templates bind.
const (
	RoleFront = "front"
	RoleSeatA = "seat-a"
	RoleSeatB = "seat-b"
)

// CaravanRef names a caravan as a cast binds it.
func CaravanRef(id string) fact.Ref { return fact.Ref{Kind: KindCaravan, ID: id} }

// LegendRef names a legend as a cast binds it.
func LegendRef(id string) fact.Ref { return fact.Ref{Kind: KindLegend, ID: id} }

// awakeSet is the awake regions, for predicates that ask of many.
func awakeSet(w World) map[int]bool {
	out := map[int]bool{}
	for _, r := range w.Awake() {
		out[r] = true
	}
	return out
}

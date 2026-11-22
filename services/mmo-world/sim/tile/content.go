package tile

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/history"
)

// structural: a fork offers an open way, one behind its machine and a
// hidden third, as gen draws them.
const WaysPerFork = 3

// Who staged a placed tile (GDD 14.5).
const (
	PlacedAdmins = "admins"
	PlacedStaff  = "staff"
)

// Content is what a tile holds, drawn at its first reach and stored
// (GDD 4.17). A native one is the seed's function, frozen.
type Content struct {
	Drawn    int64            `json:"drawn"`
	Native   bool             `json:"native,omitempty"`
	Key      string           `json:"key,omitempty"`
	Digest   *history.Digest  `json:"digest,omitempty"`
	Site     string           `json:"site,omitempty"`     // a pin's slot over the scaffold's
	Landmark string           `json:"landmark,omitempty"` // a pin's landmark
	SiteKind string           `json:"siteKind,omitempty"`
	Lead     string           `json:"lead,omitempty"`
	Stock    map[string]int64 `json:"stock,omitempty"` // node units at the start, per region material
	Dungeon  *Plan            `json:"dungeon,omitempty"`
	Pin      string           `json:"pin,omitempty"`
	Placed   *Placed          `json:"placed,omitempty"`
}

// Plan is a dungeon's stored plan; a native one keeps no floors.
type Plan struct {
	Kind     string      `json:"kind"`
	Floors   int64       `json:"floors"`
	Guardian string      `json:"guardian,omitempty"`
	Up       bool        `json:"up,omitempty"`
	SeedTier int64       `json:"seedTier"`
	Ways     []Ways      `json:"ways,omitempty"`  // by N
	Drawn    []FloorDraw `json:"drawn,omitempty"` // by (N, Way)
}

// Ways are floor N's ways down, drawn at its first reach by any way.
type Ways struct {
	N   int64            `json:"n"`
	Way [WaysPerFork]Way `json:"way"`
}

// Way is one way down from a fork.
type Way struct {
	Fork string   `json:"fork,omitempty"`
	Tags []string `json:"tags,omitempty"`
}

// FloorDraw is floor N reached by Way as its first reach drew it. Pick is
// kept raw so the creature is chosen from the pool at the live tier.
type FloorDraw struct {
	N       int64  `json:"n"`
	Way     int64  `json:"way"`
	Beats   int64  `json:"beats"`
	Machine bool   `json:"machine,omitempty"`
	Family  string `json:"family,omitempty"`
	Pick    int64  `json:"pick"`
}

// Placed says a place was staged, by whom and at what cost (GDD 14.5).
type Placed struct {
	By     string `json:"by"` // admins, staff
	Server string `json:"server"`
	Label  string `json:"label"`
	Points int64  `json:"points,omitempty"`
}

// Fix is what a pin sets; "" and 0 leave a field to the draw.
type Fix struct {
	Site     string `json:"site,omitempty"`
	Landmark string `json:"landmark,omitempty"`
	SiteKind string `json:"siteKind,omitempty"`
	Dungeon  string `json:"dungeon,omitempty"`
	Floors   int64  `json:"floors,omitempty"`
	Lead     string `json:"lead,omitempty"`
	Stock    string `json:"stock,omitempty"` // map.stock-bands row
}

// Empty reports whether the fix sets nothing.
func (f Fix) Empty() bool { return f == Fix{} }

func floorOrder(a FloorDraw, n, way int64) int {
	return cmp.Or(cmp.Compare(a.N, n), cmp.Compare(a.Way, way))
}

// Floor is floor n by way as stored, if it has been reached.
func (p *Plan) Floor(n, way int64) (*FloorDraw, bool) {
	if i, ok := slices.BinarySearchFunc(p.Drawn, n, func(f FloorDraw, n int64) int { return floorOrder(f, n, way) }); ok {
		return &p.Drawn[i], true
	}
	return nil, false
}

// SetFloor stores a floor's draw, keeping Drawn ordered by (N, Way).
func (p *Plan) SetFloor(f FloorDraw) {
	i, ok := slices.BinarySearchFunc(p.Drawn, f.N, func(d FloorDraw, n int64) int { return floorOrder(d, n, f.Way) })
	if ok {
		p.Drawn[i] = f
		return
	}
	p.Drawn = slices.Insert(p.Drawn, i, f)
}

func waysOrder(w Ways, n int64) int { return cmp.Compare(w.N, n) }

// WaysOf is floor n's ways down as stored, if they have been drawn.
func (p *Plan) WaysOf(n int64) (*[WaysPerFork]Way, bool) {
	if i, ok := slices.BinarySearchFunc(p.Ways, n, waysOrder); ok {
		return &p.Ways[i].Way, true
	}
	return nil, false
}

// SetWays stores a floor's ways, keeping Ways ordered by N.
func (p *Plan) SetWays(w Ways) {
	i, ok := slices.BinarySearchFunc(p.Ways, w.N, waysOrder)
	if ok {
		p.Ways[i] = w
		return
	}
	p.Ways = slices.Insert(p.Ways, i, w)
}

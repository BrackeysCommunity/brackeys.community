// Package arc is the director's pure half (GDD 12): the templates' casts,
// the bounded view of the world their predicates read, and the arithmetic
// of marks, pay and standing. It never imports the game; the game
// implements World and runs what Compile returns.
package arc

import (
	"cmp"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// Scopes an arc runs at (GDD 12.4). The world scope is ScopeWorld because
// World is the view predicates read.
const (
	ScopeWorld = "world"
	Region     = "region"
	Settlement = "settlement"
	Personal   = "personal"
)

// What a side's mark counts.
const (
	WantGoods   = "goods"
	WantBeats   = "beats"
	WantReach   = "reach"
	WantSold    = "sold"
	WantDefence = "defence"
)

// Kinds of pending thread candidates.
const (
	PendDebt   = "debt"
	PendReturn = "return"
	PendOath   = "oath"
	PendRival  = "rival"
)

// Binding fills one cast role.
type Binding struct {
	Role string   `json:"role"`
	Ref  fact.Ref `json:"ref"`
}

// Cast is sorted by role; Key is "role=kind:id;…" for draws and duplicates.
type Cast []Binding

// Get is the ref bound to role.
func (c Cast) Get(role string) (fact.Ref, bool) {
	for _, b := range c {
		if b.Role == role {
			return b.Ref, true
		}
	}
	return fact.Ref{}, false
}

// Key names the cast whatever order it was built in.
func (c Cast) Key() string {
	var sb strings.Builder
	for i, b := range Sorted(c) {
		if i > 0 {
			sb.WriteByte(';')
		}
		sb.WriteString(b.Role)
		sb.WriteByte('=')
		sb.WriteString(b.Ref.String())
	}
	return sb.String()
}

// Sorted is a copy of c in role order, then ref order.
func Sorted(c Cast) Cast {
	out := slices.Clone(c)
	slices.SortStableFunc(out, func(a, b Binding) int {
		return cmp.Or(cmp.Compare(a.Role, b.Role), cmp.Compare(a.Ref.Kind, b.Ref.Kind), cmp.Compare(a.Ref.ID, b.Ref.ID))
	})
	return out
}

// Candidate is one cast a predicate found.
type Candidate struct {
	Cast     Cast
	Regions  []int   // sorted; where active characters count and beats are read
	Seat     hex.Hex // where its facts are located and goods land by default
	Causes   []fact.ID
	Pressure int64    // orders candidates; scores a finale
	Char     string   // personal: whose thread
	Place    int      // settlement scope: the place; -1 otherwise
	From     *Pending // personal: the pending candidate it was cast from
	Via      fact.Ref // personal: the faction whose offer cap it counts against
}

// World is what predicates read. Every method costs at most the regions,
// factions, places, the memory ring or the pending queue.
type World interface {
	Day() int64
	Awake() []int
	Gauge(region int, gauge string) int64
	Line(region int, line string) bool
	Neighbours(region int) []int
	Holder(region int) int
	Defence(region int) int64
	RegionHex(region int) hex.Hex
	RegionOf(h hex.Hex) int
	Factions() []FactionView
	Places() []PlaceView
	Streak(region int, streak string) int64
	Recall(kind string, withinDays int64) []Memory
	Pending(kind string) []Pending
	Busy(scope string, ref fact.Ref) bool
	Core() (hex.Hex, bool) // the open core
	NearestPlace(h hex.Hex) (int, bool)
}

// FactionView is one faction as predicates see it.
type FactionView struct {
	ID           int
	Archetype    string
	Tags         []string
	Seat         int
	Holdings     []int
	Stock        int64
	Starving     bool
	StarvingDays int64
	Fallen       bool
	Grudge       []int64 // days, by faction index
	Disposition  []int64 // by faction index
	Notables     []NotableView
}

// NotableView is one of a faction's notables.
type NotableView struct {
	ID      string
	Role    string
	Loyalty int64
	Dead    bool
	Leading bool
}

// PlaceView is one settlement as predicates see it.
type PlaceView struct {
	N                             int
	Hex                           hex.Hex
	Region                        int
	Guild                         string
	Chartered, Open, Ruined, City bool
	Structures                    int64
	Raised                        int64 // tick of the last raise
	Users                         int64
	Lost                          int64
}

// Memory is one fact kept in the story's bounded ring.
type Memory struct {
	Fact     fact.ID    `json:"fact"`
	Tick     int64      `json:"tick"`
	Kind     string     `json:"kind"`
	Region   int        `json:"region"`
	At       hex.Hex    `json:"at"`
	Subjects []fact.Ref `json:"subjects,omitempty"`
	N        int64      `json:"n,omitempty"`
}

// Pending is a personal thread candidate a hook queued.
type Pending struct {
	Kind string   `json:"kind"`
	Char string   `json:"char"`
	Ref  fact.Ref `json:"ref"`
	Tick int64    `json:"tick"`
	Fact fact.ID  `json:"fact"`
	// Via is the faction whose standing offered it; zero for a candidate
	// the character earned.
	Via fact.Ref `json:"via,omitempty,omitzero"`
	// Offer marks the thread gate's, which goes before any earned
	// candidate when the queue is full.
	Offer bool `json:"offer,omitempty"`
}

// Faction is the faction whose offer cap a candidate counts against: the
// one that offered it, else the one a rival is against. A rival's Ref is
// already its faction, so a won side's rivals keep no Via and save as
// they always have.
func (p Pending) Faction() fact.Ref {
	if p.Via != (fact.Ref{}) || p.Kind != PendRival {
		return p.Via
	}
	return p.Ref
}

// Predicate finds the casts a template could take today.
type Predicate func(w World, row Row, p Params) []Candidate

// Row is a template's sheet row; exactly one of Arc, Trouble and Occasion
// is set, by the sheet it came from.
type Row struct {
	ID, Scope, When string
	Chance          int64
	Cast            []sheets.CastRow
	Stages          []sheets.StageRow
	Arc             *sheets.ArcRow
	Trouble         *sheets.TroubleRow
	Occasion        *sheets.OccasionRow
}

// Template is a row with its predicate resolved.
type Template struct {
	Row  Row
	When Predicate
}

// Predicates by When id, registered from the predicate files' init funcs.
// Compile fails on a row naming one not here.
var Predicates = map[string]Predicate{}

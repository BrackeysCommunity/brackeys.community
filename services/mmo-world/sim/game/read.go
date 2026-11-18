package game

import (
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
)

// Move is one of the six steps from where a character stands.
type Move struct {
	Dir   int     `json:"dir"`
	To    hex.Hex `json:"to"`
	Open  bool    `json:"open"`
	Ticks int64   `json:"ticks"`
	Why   []Part  `json:"why"`
}

// FightView is the beat a character faces and its options. Options carry
// their exact chance; readers outside the sim pass on bands only.
type FightView struct {
	ID       string         `json:"id"`
	Beat     int            `json:"beat"`
	Beats    int            `json:"beats"`
	Kind     string         `json:"kind"`
	Creature string         `json:"creature"`
	Options  []fight.Option `json:"options"`
	Ambush   bool           `json:"ambush"`
	Default  string         `json:"default,omitempty"` // what an ambush takes when its owner stays away
	Due      int64          `json:"due,omitempty"`
}

// Choices is everything a character can do now.
type Choices struct {
	Moves      []Move     `json:"moves"`
	Materials  []string   `json:"materials"`
	GatherMin  int64      `json:"gatherMin"`
	GatherMax  int64      `json:"gatherMax"`
	Rest       bool       `json:"rest"`
	Explore    bool       `json:"explore"`
	Long       *Long      `json:"long,omitempty"`
	Fight      *FightView `json:"fight,omitempty"`
	CanCancel  bool       `json:"canCancel"`
	FreeToMove bool       `json:"freeToMove"`
}

// Choose lists what a character can do now. Nothing here changes the game.
func (g *Game) Choose(c *Char) Choices {
	t := g.Tick()
	out := Choices{Long: c.Long, CanCancel: c.Long != nil, FreeToMove: free(c) == nil}
	if c.Fight != nil {
		e := c.Fight.E
		_, _, opts := g.r.Fight.Choices(e, c.C, g.r.Fight.KitOf(c.C), t)
		v := &FightView{ID: e.ID, Beat: e.At, Beats: len(e.Beats), Kind: e.Beats[e.At], Creature: e.Creature.Archetype,
			Options: opts, Ambush: c.Fight.Ambush, Due: c.Fight.Due}
		if c.Fight.Ambush {
			v.Default = wayOut
		}
		out.Fight = v
	}
	if !out.FreeToMove || c.Banned {
		out.FreeToMove = false
		return out
	}
	for d := range hex.Directions {
		to := c.C.At.Neighbour(d)
		ticks, why, ok := g.EnterCost(c, c.C.At, to, t)
		out.Moves = append(out.Moves, Move{Dir: d, To: to, Open: ok, Ticks: ticks, Why: why})
	}
	out.Materials = g.Materials(c.C.At)
	out.GatherMin, out.GatherMax = g.r.wp("gather-ticks-min"), g.r.wp("gather-ticks-max")
	site := g.r.Gen.Baseline(c.C.At).Site
	out.Rest = site == gen.PlaceSettlement
	out.Explore = site != "" && site != gen.PlaceSettlement && len(g.r.Gen.Creatures(c.C.At)) > 0
	return out
}

// BandName is the odds band an option's band rank names.
func (g *Game) BandName(rank int64) string { return g.r.Fight.BandName(rank) }

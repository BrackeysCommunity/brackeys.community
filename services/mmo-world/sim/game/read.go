package game

import (
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/world"
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
	// Shared names a shared encounter; Mine is the viewer's own held pick
	// on it, never another's.
	Shared string `json:"shared,omitempty"`
	Mine   string `json:"mine,omitempty"`
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
		_, opts := g.beat(c, t)
		v := &FightView{ID: e.ID, Beat: e.At, Beats: len(e.Beats), Kind: e.Beats[e.At], Creature: e.Creature.Archetype,
			Options: opts, Ambush: c.Fight.Ambush, Due: c.Fight.Due}
		if c.Fight.Ambush {
			v.Default = wayOut
		}
		if sh := g.SharedByID(c.Fight.Shared); sh != nil {
			v.Shared, v.Mine = sh.ID, sh.pickOf(c.C.ID)
			if !c.Fight.Ambush {
				v.Default = g.r.Fight.Cautious()
			}
		}
		out.Fight = v
	}
	if !out.FreeToMove || c.Banned {
		out.FreeToMove = false
		return out
	}
	laden := g.Laden(c)
	for d := range hex.Directions {
		to := c.C.At.Neighbour(d)
		var why []Part
		ticks, ok := g.enterCost(c, c.C.At, to, t, laden, &why)
		out.Moves = append(out.Moves, Move{Dir: d, To: to, Open: ok, Ticks: ticks, Why: why})
	}
	for _, m := range g.Materials(c.C.At) {
		if !g.WorkedOut(c.C.At, m) {
			out.Materials = append(out.Materials, m)
		}
	}
	out.GatherMin, out.GatherMax = g.r.wp("gather-ticks-min"), g.r.wp("gather-ticks-max")
	out.Rest = g.CanRest(c.C.At)
	out.Explore = g.CanExplore(c.C.At)
	return out
}

// CanRest reports whether a tile is somewhere to rest: a settlement.
func (g *Game) CanRest(h hex.Hex) bool { return g.IsSettlement(h) }

// CanExplore reports whether a tile has a site to explore and something
// living there to meet; a dungeon's first floor, once cleared, waits for
// its refill.
func (g *Game) CanExplore(h hex.Hex) bool {
	site := g.r.Gen.Baseline(h).Site
	return site != "" && site != gen.PlaceSettlement && len(g.r.Gen.Creatures(h)) > 0 && !g.FloorCleared(h)
}

// FloorCleared reports whether a dungeon's first floor is cleared and not
// yet refilled (GDD 4.9).
func (g *Game) FloorCleared(h hex.Hex) bool { return g.FloorClearedAt(h, firstFloor) }

// FloorClearedAt reports whether a dungeon's floor is cleared and not yet
// refilled; each floor refills on its own (GDD 4.9).
func (g *Game) FloorClearedAt(h hex.Hex, floor int64) bool {
	return g.floorRead(h, floor)
}

// IsDungeon reports whether a tile is a dungeon's entrance, a relay
// tower's among them.
func (g *Game) IsDungeon(h hex.Hex) bool {
	_, ok := g.r.Gen.Dungeon(h)
	return ok
}

// structural: a dungeon's entrance floor.
const firstFloor = 1

// BandName is the odds band an option's band rank names.
func (g *Game) BandName(rank int64) string { return g.r.Fight.BandName(rank) }

// beat is c's kit and options on its encounter's current beat.
func (g *Game) beat(c *Char, tick int64) (fight.Kit, []fight.Option) {
	k := g.r.Fight.KitOf(c.C)
	k.Self = append(k.Self, g.fightTags(c, c.Fight.E)...)
	_, kit, opts := g.r.Fight.Choices(c.Fight.E, c.C, k, tick)
	return kit, opts
}

// Option is the option id on c's current beat, if c is in an encounter
// and the beat offers it.
func (g *Game) Option(c *Char, id string) (fight.Option, bool) {
	if c.Fight == nil {
		return fight.Option{}, false
	}
	_, opts := g.beat(c, g.Tick())
	return fight.OptionByID(opts, id)
}

// Suggestion is a first outing: the nearest site to explore, how far, and
// the first step toward it (GDD 3.1).
type Suggestion struct {
	At    hex.Hex `json:"at"`
	Tiles int64   `json:"tiles"`
	Dir   int     `json:"dir"`
}

// Suggest is the nearest explorable site within the suggestion radius a
// character can walk to, or false.
func (g *Game) Suggest(from hex.Hex) (Suggestion, bool) {
	for r := int64(1); r <= g.r.wp("suggest-radius"); r++ {
		for _, h := range hex.Ring(from, r) {
			if !g.CanExplore(h) {
				continue
			}
			if path, _, ok := g.World.Path(from, h); ok && len(path) > 1 {
				return Suggestion{At: h, Tiles: int64(len(path) - 1), Dir: from.DirectionTo(path[1])}, true
			}
		}
	}
	return Suggestion{}, false
}

// CardNumbers are the sheet values the chat cards state.
type CardNumbers struct {
	AmbushLine, OverrunLine      int64 // threat
	CrawlTicks, WoundedTicks     int64
	FreeTicks                    int64 // journey ticks before provisions are eaten
	StepMin, StepMax             int64 // ticks a tile, by terrain
	FirstBeatsMin, FirstBeatsMax int64 // beats in a first-tier encounter
}

// CardNumbers reads them from the book.
func (r *Rules) CardNumbers() CardNumbers {
	out := CardNumbers{AmbushLine: world.LineAt(r.Book, "ambush"), OverrunLine: world.LineAt(r.Book, "overrun"),
		CrawlTicks: r.wp("crawl-ticks"), WoundedTicks: r.wp("wounded-ticks"), FreeTicks: r.wp("provisions-free-ticks")}
	for _, t := range r.Book.Terrain {
		if !t.Passable {
			continue
		}
		if out.StepMin == 0 || t.EnterTicks < out.StepMin {
			out.StepMin = t.EnterTicks
		}
		out.StepMax = max(out.StepMax, t.EnterTicks)
	}
	for _, t := range r.Book.FightTiers {
		if t.Tier == r.firstTier() {
			out.FirstBeatsMin, out.FirstBeatsMax = t.BeatsMin, t.BeatsMax
		}
	}
	return out
}

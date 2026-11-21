package gen

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// PlaceRelay is the pattern place every relay tower stands on.
const PlaceRelay = "relay"

// structural: a fork offers an open way, one behind its machine and a
// hidden third; a half step is one of two between whole tiers.
const (
	WayOpen    = 0
	WayMachine = 1
	WayHidden  = 2
	forkWays   = 3
	halfSteps  = 2
)

// Plan is a dungeon as the seed makes it (GDD 4.9).
type Plan struct {
	Hex      Hex
	Kind     string // map.dungeons row
	Floors   int64  // 3..7
	Guardian string // fights.hunts row
	Up       bool   // a relay tower's floors go up
	SeedTier int64
}

// Way is one way down from a fork.
type Way struct {
	Fork string     // map.forks row
	Tags []tags.Tag // 1..3
}

// Step is where a floor's half steps put it among the tiers: the whole
// tier its creature and machines come from, whether it sits half way to
// the next, and how many whole tiers it lies past the ceiling.
type Step struct {
	Tier   int64
	Half   bool
	Beyond int64
}

// FloorPlan is floor n reached by a way (−1 for floor 1), as the seed
// makes it.
type FloorPlan struct {
	N        int64
	Steps    int64      // half steps above the entrance: N−1
	Step     Step       // from the tier Floor was asked at
	Tags     []tags.Tag // kind's, the entrance tile's, the way in's
	Beats    int64      // the floor's beats, less the third way's cut
	Hidden   int64      // beats the party starts hidden, by the third way
	Bottom   bool
	Ways     [forkWays]Way // [2] is the hidden third way; empty on the bottom floor
	Machine  bool          // way 1 is behind a machine
	Family   string        // the fork machine's family
	Creature string        // archetype from the kind's pool at the stepped tier
}

// Dungeon is the dungeon whose entrance is h; false when no dungeon or
// relay place stands there. It reads the tile's baseline and its own
// draws only, so it never moves world generation.
func (g *Gen) Dungeon(h Hex) (Plan, bool) {
	b := g.Baseline(h)
	return g.plan(h, b.Site, b.HomeDist)
}

func (g *Gen) plan(h Hex, site string, homeDist int64) (Plan, bool) {
	var kinds []*sheets.DungeonKind
	var weights []int64
	for i := range g.b.Dungeons {
		if k := &g.b.Dungeons[i]; k.Place == site && k.Share > 0 {
			kinds, weights = append(kinds, k), append(weights, k.Share)
		}
	}
	if len(kinds) == 0 {
		return Plan{}, false
	}
	at := draw.Str(h.Ref())
	k := kinds[g.d.Pick(weights, "dungeon.kind", at)]
	p := Plan{Hex: h, Kind: k.ID, Up: k.Up, SeedTier: g.SeedTier(homeDist), Floors: k.FloorsMin}
	if d, ok := sheets.DepthAt(g.b.Depths, p.SeedTier); ok {
		w := make([]int64, len(d.Weights))
		for i, x := range d.Weights {
			w[i] = x.Weight
		}
		p.Floors = min(k.FloorsMax, max(k.FloorsMin, d.Weights[g.d.Pick(w, "dungeon.floors", at)].Floors))
	}
	if gd, ok := sheets.GuardianOf(g.b.Hunts, k.ID); ok {
		p.Guardian = gd.ID
	}
	return p, true
}

// SeedTier is the tier a tile has with every starting settlement open:
// the lowest it can fall to, read from the seed alone.
func (g *Gen) SeedTier(homeDist int64) int64 {
	return min(g.p.tierCeiling, 1+homeDist/g.p.tierStep)
}

// Steps is where half steps above a tier put a floor: past the ceiling
// the tier stays there and counts whole tiers beyond it.
func (g *Gen) Steps(tier, steps int64) Step {
	s := Step{Tier: tier + steps/halfSteps, Half: steps%halfSteps == 1}
	if s.Tier > g.p.tierCeiling {
		s.Beyond, s.Tier = s.Tier-g.p.tierCeiling, g.p.tierCeiling
	}
	return s
}

// Floor is floor n of the dungeon at h, reached by way (−1 for floor 1),
// stepped from the entrance's seed tier.
func (g *Gen) Floor(h Hex, n, way int64) FloorPlan {
	p, ok := g.Dungeon(h)
	if !ok {
		return FloorPlan{}
	}
	return g.floor(p, g.tileTags(h), n, way, p.SeedTier)
}

// FloorAt is Floor stepped from a live tier: only the creature differs.
func (g *Gen) FloorAt(h Hex, n, way, tier int64) FloorPlan {
	p, ok := g.Dungeon(h)
	if !ok {
		return FloorPlan{}
	}
	return g.floor(p, g.tileTags(h), n, way, tier)
}

// floor draws every part keyed on the entrance, the floor and the way in.
// A floor's ways are keyed on the entrance and floor alone, so the way
// into the next floor, and its tags, are known from (n, way) without the
// path that led there.
func (g *Gen) floor(p Plan, entrance []tags.Tag, n, way, tier int64) FloorPlan {
	k := g.kind(p.Kind)
	at := []draw.Part{draw.Str(p.Hex.Ref()), draw.Int(n), draw.Int(way)}
	f := FloorPlan{N: n, Steps: n - 1, Bottom: n >= p.Floors}
	f.Step = g.Steps(tier, f.Steps)
	f.Tags = append(tags.Of(k.Tags), entrance...)
	if n > 1 && way >= 0 && way < forkWays {
		f.Tags = append(f.Tags, g.ways(p, n-1)[way].Tags...)
	}
	slices.Sort(f.Tags)
	f.Tags = slices.Compact(f.Tags)
	f.Beats = g.d.Between(g.mp("floor-beats-min"), g.mp("floor-beats-max"), "dungeon.beats", at...)
	if way == WayHidden {
		f.Beats = max(1, f.Beats-g.fp("third-way-beats"))
		f.Hidden = g.fp("third-way-hidden")
	}
	f.Creature = g.floorCreature(k, f.Step.Tier, at)
	if f.Bottom {
		return f
	}
	f.Ways = g.ways(p, n)
	if f.Machine = g.d.Percent(g.mp("fork-machine-share"), "dungeon.fork-machine", at...); f.Machine && len(k.Families) > 0 {
		f.Family = k.Families[g.d.Below(uint64(len(k.Families)), "dungeon.fork-family", at...)]
	}
	return f
}

// ways are the three ways down from floor n, distinct, weighted.
func (g *Gen) ways(p Plan, n int64) [forkWays]Way {
	var rows []*sheets.Fork
	var weights []int64
	for i := range g.b.Forks {
		if f := &g.b.Forks[i]; slices.Contains(f.Kinds, p.Kind) {
			rows, weights = append(rows, f), append(weights, f.Weight)
		}
	}
	var out [forkWays]Way
	s := g.d.Stream("dungeon.fork", draw.Str(p.Hex.Ref()), draw.Int(n))
	for i := range out {
		if len(rows) == 0 {
			break
		}
		j := s.Pick(weights)
		out[i] = Way{Fork: rows[j].ID, Tags: tags.Of(rows[j].Tags)}
		rows, weights = slices.Delete(rows, j, j+1), slices.Delete(weights, j, j+1)
	}
	return out
}

// floorCreature draws from the kind's creatures at the tier, or failing
// any, from every archetype of the tier.
func (g *Gen) floorCreature(k *sheets.DungeonKind, tier int64, at []draw.Part) string {
	var pool []string
	for _, id := range k.Creatures {
		if c := g.creature(id); c != nil && c.Tier == tier {
			pool = append(pool, id)
		}
	}
	if len(pool) == 0 {
		for _, c := range g.b.Creatures {
			if c.Tier == tier {
				pool = append(pool, c.ID)
			}
		}
	}
	if len(pool) == 0 {
		return ""
	}
	return pool[g.d.Below(uint64(len(pool)), "dungeon.creature", at...)]
}

// tileTags are the entrance tile's own tags: its terrain's and the place
// tags that terrain carries.
func (g *Gen) tileTags(h Hex) []tags.Tag {
	t := g.terrain[g.Baseline(h).Terrain]
	if t == nil {
		return nil
	}
	return append(tags.Of(t.Tags), tags.Of(t.PlaceTags)...)
}

func (g *Gen) kind(id string) *sheets.DungeonKind {
	for i := range g.b.Dungeons {
		if g.b.Dungeons[i].ID == id {
			return &g.b.Dungeons[i]
		}
	}
	panic("gen: no dungeon kind " + id)
}

func (g *Gen) creature(id string) *sheets.Creature {
	for i := range g.b.Creatures {
		if g.b.Creatures[i].ID == id {
			return &g.b.Creatures[i]
		}
	}
	return nil
}

func (g *Gen) mp(id string) int64 { return sheets.IntParam(g.b.MapParams, id) }
func (g *Gen) fp(id string) int64 { return sheets.IntParam(g.b.FightParams, id) }

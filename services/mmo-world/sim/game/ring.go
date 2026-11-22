package game

import (
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// The ring of eight (GDD 4.13): relay towers round the dead city core.
// When every tower's guardian has fallen in one season the core opens and
// the opening is cast there. The ring's towers and core are the scaffold's
// own pattern, read and never moved; whether the core is open is stored.

const factGuardianSlain = "guardian.slain"

// structural: the anchor the ring is measured from, as map.patterns
// spells it.
const anchorOrigin = "origin"

// ringRule is the map.patterns rule that lays the ring: the first anchored
// on the origin with relay towers among its parts.
func (g *Game) ringRule() (string, bool) {
	for _, r := range g.r.Book.Patterns {
		if r.Anchor == anchorOrigin && slices.ContainsFunc(r.Parts, func(p sheets.PatternPart) bool { return p.Place == gen.PlaceRelay }) {
			return r.ID, true
		}
	}
	return "", false
}

// ringOf is the ring, made from the scaffold the first time it is needed:
// the towers the scaffold keeps standing, and the core at its centre.
func (g *Game) ringOf() *Ring {
	if g.Story == nil {
		return nil
	}
	if g.Story.Ring != nil {
		return g.Story.Ring
	}
	rule, ok := g.ringRule()
	if !ok {
		return nil
	}
	in, ok := g.r.Gen.OriginInstance(rule)
	if !ok {
		return nil
	}
	ring := &Ring{Core: in.Centre}
	for _, p := range in.Points {
		if p.Place == gen.PlaceRelay && g.r.Gen.Standing(p) && !slices.Contains(ring.Towers, p.Hex) {
			ring.Towers = append(ring.Towers, p.Hex)
		}
	}
	if len(ring.Towers) == 0 {
		return nil
	}
	slices.SortFunc(ring.Towers, hex.Compare)
	if c, ok := g.clock(); ok {
		ring.Season = c.N
	}
	g.Story.Ring = ring
	return ring
}

// ringSeason starts the ring's tally afresh in a new season.
func (g *Game) ringSeason(ring *Ring) {
	if c, ok := g.clock(); ok && ring.Season != c.N {
		ring.Season, ring.Fell = c.N, nil
	}
}

// ringFact tallies a guardian slain at a tower this season. It runs as the
// story remembers a step's facts, after they are written, so it only
// counts: the core opens in the day turn.
func (g *Game) ringFact(f fact.Fact) {
	if g.Story == nil || f.Kind != factGuardianSlain {
		return
	}
	h, ok := fact.HexOf(f)
	if !ok {
		return
	}
	ring := g.ringOf()
	if ring == nil || !slices.Contains(ring.Towers, h) {
		return
	}
	g.ringSeason(ring)
	if i, found := slices.BinarySearchFunc(ring.Fell, h, hex.Compare); !found {
		ring.Fell = slices.Insert(ring.Fell, i, h)
	}
}

// ringDue opens the core when every tower has fallen this season. The
// tally is spent on it: a core sealed again needs every tower anew.
func (g *Game) ringDue(t int64) error {
	ring := g.Story.Ring
	if ring == nil {
		return nil
	}
	g.ringSeason(ring)
	if ring.Open != 0 || len(ring.Fell) < len(ring.Towers) {
		return nil
	}
	// Each tower's newest fall is a cause.
	last := make([]fact.ID, len(ring.Towers))
	for _, m := range g.Story.Memory {
		if i := slices.Index(ring.Towers, m.At); m.Kind == factGuardianSlain && i >= 0 {
			last[i] = max(last[i], m.Fact)
		}
	}
	var causes []fact.ID
	for _, id := range last {
		if id > 0 {
			causes = append(causes, id)
		}
	}
	slices.Sort(causes)
	ring.Fell = nil
	return g.openCore(causes, ByOpening, t)
}

// openCore opens the core, if it is shut, and casts the opening there at
// once while the world's slot is free. A core whose opening must wait
// stays open through the next season, so the next rising band casts it.
func (g *Game) openCore(causes []fact.ID, by string, t int64) error {
	ring := g.ringOf()
	c, ok := g.clock()
	if ring == nil || !ok {
		return nil
	}
	var fresh []arc.Memory
	if ring.Open == 0 {
		// A core opened on the world's first tick still reads open.
		ring.Open = max(t, 1)
		id, err := g.worldFact(ring.Core, "core.opened", []fact.Ref{arc.TileRef(ring.Core)}, causes,
			append([]fact.Datum{fact.N("season", c.N), fact.N("towers", int64(len(ring.Towers)))}, fact.At(ring.Core)...)...)
		if err != nil {
			return err
		}
		if f, ok := g.Log.Get(id); ok {
			fresh = append(fresh, g.memoryOf(f))
		}
	}
	cast, err := g.castOpening(fresh, by, t)
	if err != nil {
		return err
	}
	until := c.N
	if !cast {
		until++
	}
	ring.Until = max(ring.Until, until)
	return nil
}

// castOpening casts the opening from its predicate, reading the core's
// opening this turn as remembered; false when the predicate finds no cast
// or the world's slot is taken.
func (g *Game) castOpening(fresh []arc.Memory, by string, t int64) (bool, error) {
	i := slices.IndexFunc(g.r.Templates, func(tpl arc.Template) bool { return tpl.Row.When == openingWhen })
	if i < 0 {
		return false, nil
	}
	tpl := g.r.Templates[i]
	w := freshView{storyView: g.storyView(), fresh: fresh}
	cand, ok := arc.Pick(tpl.When(w, tpl.Row, g.r.Story), g.r.draw, tpl.Row.ID, arc.ScopeWorld, t/sheets.TicksPerDay)
	if !ok {
		return false, nil
	}
	a, err := g.castFrom(tpl, cand, by, t)
	if err = refusedIsNothing(err); err != nil {
		return false, err
	}
	return a != nil, nil
}

// ringClose is the season's close for the ring: the tally starts afresh,
// and a core past the season it was held open through shuts.
func (g *Game) ringClose() error {
	ring := g.Story.Ring
	c, ok := g.clock()
	if ring == nil || !ok {
		return nil
	}
	ring.Fell = nil
	if ring.Open == 0 || ring.Until > c.N {
		return nil
	}
	ring.Open, ring.Until = 0, 0
	_, err := g.worldFact(ring.Core, "core.sealed", []fact.Ref{arc.TileRef(ring.Core)}, nil,
		append([]fact.Datum{fact.N("season", c.N)}, fact.At(ring.Core)...)...)
	return err
}

package game

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/ledger"
)

// A rescue on a dungeon's floors (GDD 4.9, 11.6): the rescuer goes
// through every floor that stands cleared with no encounter, clears the
// rest, and lifts the downed where it lies to carry it up (carryUp).

// rescuing is the downed character a delver has come down for: one who
// called for help and lies deeper on this dungeon's floors, carried by
// nobody; the shallowest first.
func (g *Game) rescuing(c *Char) *Char {
	var best *Char
	for _, d := range g.CharsAt(c.C.At) {
		if d == c || d.C.Floor <= c.C.Floor || notDown(d) == nil || d.CarriedBy != "" || !g.Called(d) {
			continue
		}
		if best == nil || d.C.Floor < best.C.Floor {
			best = d
		}
	}
	return best
}

// pushThrough takes a rescuer at the entrance down through the cleared
// first floor; a first floor that stands is explored as any other.
func (g *Game) pushThrough(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	if _, ok := g.r.Gen.Dungeon(c.C.At); !ok {
		return refuse(NoFork, "%s stands at no dungeon", c.C.ID)
	}
	if g.rescuing(c) == nil {
		return refuse(NoFork, "%s stands at the entrance: explore the first floor", c.C.ID)
	}
	if !g.floorRead(c.C.At, firstFloor) {
		return refuse(NoFork, "the first floor stands: explore it")
	}
	return g.through(c, firstFloor, g.Tick())
}

// through stands a rescuer on cleared floor n with no encounter: by the
// one it came for, or at the floor's fork to push on.
func (g *Game) through(c *Char, n, tick int64) error {
	h := c.C.At
	if c.Delving == nil || c.Delving.Dungeon != h.Ref() {
		c.Delving = &Delving{Dungeon: h.Ref(), Way: noWay}
	}
	c.C.Floor = n
	if _, err := g.fact(c, "dungeon.reached", tick, append([]fact.Datum{fact.N("floor", n), fact.N("way", c.Delving.Way), fact.N("through", 1)}, fact.At(h)...)...); err != nil {
		return err
	}
	plan, _ := g.r.Gen.Dungeon(h)
	d := g.rescuing(c)
	if n >= plan.Floors || d == nil {
		return nil
	}
	g.openFork(c, n)
	return nil
}

// carryUp starts a rescuer up from the floor it lifted someone on: at once
// with The way back, else through a carry up of carry-up-beats hazard
// beats a floor.
func (g *Game) carryUp(c *Char, key string) error {
	h, n := c.C.At, c.C.Floor
	if c.Delving == nil {
		c.Delving = &Delving{Dungeon: h.Ref(), Way: noWay}
	}
	if _, sh := g.forkOf(c); sh != nil {
		g.leaveShared(sh, c)
	}
	c.Delving.Climb = n
	if g.wayBack(c) {
		return g.climbOut(c, ledger.SubKey(key, "climb"))
	}
	arch := g.r.Gen.FloorAt(h, n, c.Delving.Way, g.tierAt(h)).Creature
	if arch == "" {
		kinds := g.r.Gen.Creatures(h)
		if len(kinds) == 0 {
			return g.climbOut(c, ledger.SubKey(key, "climb"))
		}
		arch = kinds[0]
	}
	beats := n * g.fp("carry-up-beats")
	g.soloEncounter(c, arch, n, beats, fight.BeatHazard)
	_, err := g.fact(c, "dungeon.reached", g.Tick(), append([]fact.Datum{fact.N("floor", n), fact.N("carrying", 1)}, fact.At(h)...)...)
	return err
}

// carriedUp is a carry up's end: through it, the climb; down in it, the
// rescuer lies on the floor too, and the one it carried is set down.
func (g *Game) carriedUp(c *Char, e *fight.Encounter) error {
	if e.Result == fight.Lost || notDown(c) != nil {
		c.Delving.Climb = 0
		return g.downOnFloor(c, e.Floor, e.ID)
	}
	return g.climbOut(c, ledger.SubKey(e.ID, "climb"))
}

// carriedFloor is the floor a call for help names, for its title: the
// floor the caller lies on, or none at the surface.
func carriedFloor(c *Char) int64 {
	if c.C.Floor > 0 && c.Delving != nil {
		return c.C.Floor
	}
	return 0
}

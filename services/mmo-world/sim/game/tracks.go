package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/world"
)

// Tracks and routes (GDD 8.6, 11.8): a creature that fled leaves a track
// to the tile it ran to, which The long hunt follows; a Haul's poster may
// hand its hauler the way it walked.

// structural: a track's maker is a character or a creature.
const trackCreature = "archetype"

// fled leaves the track of a creature that fled an encounter on its tile.
// The track is the tile's own, laid as the creature leaves it.
func (g *Game) fled(c *Char, e *fight.Encounter) error {
	if !slices.Contains(e.Why, whyFlees) || (e.Result != fight.Won && e.Result != fight.Held) {
		return nil
	}
	by := fact.Ref{Kind: trackCreature, ID: e.Creature.Archetype}
	h := c.C.At
	if slices.ContainsFunc(g.Pending, func(a world.Action) bool { return a.Kind == world.ActVisit && a.Hex == h && a.By == by }) {
		return nil
	}
	g.Pending = append(g.Pending, world.Action{Kind: world.ActVisit, Hex: h, By: by})
	return nil
}

// structural: the why line Assemble writes for a creature that flees.
const whyFlees = "flees"

// FledTrack is a creature that fled a tile, and the neighbour it ran to.
type FledTrack struct {
	Creature string  `json:"creature"`
	Tick     int64   `json:"tick"`
	To       hex.Hex `json:"to"`
}

// FledTracks are the creatures' tracks on a tile a character can still
// read, newest first. Where each ran is a neighbour it could enter, drawn
// for the tile, the creature and the tick, so every reader sees one way.
func (g *Game) FledTracks(c *Char, h hex.Hex) []FledTrack {
	tl := g.World.Tile(h)
	if tl == nil {
		return nil
	}
	w := g.trackWindow(c)
	var out []FledTrack
	for i := len(tl.Tracks) - 1; i >= 0; i-- {
		k := tl.Tracks[i]
		if k.Who.Kind != trackCreature || g.Tick()-k.Tick > w {
			continue
		}
		var open []hex.Hex
		for d := range hex.Directions {
			if n := h.Neighbour(d); g.passable(h, n) {
				open = append(open, n)
			}
		}
		if len(open) == 0 {
			continue
		}
		to := open[g.r.draw.Below(uint64(len(open)), "track.fled", draw.Str(h.Ref()), draw.Str(k.Who.ID), draw.Int(k.Tick))]
		out = append(out, FledTrack{Creature: k.Who.ID, Tick: k.Tick, To: to})
	}
	return out
}

func (g *Game) passable(from, to hex.Hex) bool {
	_, ok := g.World.EnterTicks(from, to)
	return ok
}

// followTrack follows the newest fled track on the tile to where its
// creature ran, and meets it there (GDD 5.9, The long hunt).
func (g *Game) followTrack(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	if !g.longHunt(c) {
		return refuse(NoTrack, "following a creature that fled takes The long hunt")
	}
	tracks := g.FledTracks(c, c.C.At)
	if len(tracks) == 0 {
		return refuse(NoTrack, "no creature's track here is fresh enough to follow")
	}
	k := tracks[0]
	from := c.C.At
	dir := from.DirectionTo(k.To)
	c.C.Walk(k.To, g.r.limits)
	c.C.Facing = dir
	g.visited(c, k.To, g.Tick())
	g.Pending = append(g.Pending, world.Action{Kind: world.ActVisit, Hex: k.To, By: char.Ref(c.C.ID), Dir: &dir})
	g.soloEncounter(c, k.Creature, 0, 0, "")
	_, err := g.fact(c, "track.followed", g.Tick(), append([]fact.Datum{fact.S("creature", k.Creature), fact.N("tick", k.Tick)}, fact.At(k.To)...)...)
	return err
}

// soloEncounter starts an encounter for a character alone against a
// creature of an archetype it did not draw: one it followed, or what
// waits on a floor it carries someone up.
func (g *Game) soloEncounter(c *Char, arch string, floor, beats int64, only string) *fight.Encounter {
	h := c.C.At
	c.Encounters++
	id := "e-" + c.C.ID + "-" + strconv.FormatInt(c.Encounters, decimal)
	extra, high := g.encounterTags(c, h, arch)
	place := append(g.World.Place(h).Tags(), high...)
	ms := g.measures(h)
	cr := g.r.Fight.Spawn(arch, extra, place, ms)
	site := fight.Site{ID: id, Place: machinePlace(h, floor), Tags: place, Measures: ms, Party: 1, Floor: floor, Beats: beats, Only: only}
	e := g.r.Fight.Assemble(site, cr)
	c.Fight = &Fight{E: e, Measures: ms}
	return e
}

// routeAlong is the way a Haul's hauler travels along the route its poster
// handed over, from wherever on it the hauler stands: once, across tiles
// it may never have seen.
func (g *Game) routeAlong(c *Char, cmd Command) ([]hex.Hex, int64, error) {
	x := g.GoalOf(cmd.Along)
	if x == nil || x.State != goal.Live || x.Cargo == nil || x.Cargo.Hauler != c.C.ID || len(x.Cargo.Route) == 0 {
		return nil, 0, refuse(NoRoute, "%s carries no haul with a route for %q", c.C.ID, cmd.Along)
	}
	if x.Cargo.Used {
		return nil, 0, refuse(Used, "the route of %s has been travelled", x.ID)
	}
	route := x.Cargo.Route[slices.Index(x.Cargo.Route, c.C.At)+1:]
	tick, laden := g.Tick(), g.Laden(c)
	from := c.C.At
	var total int64
	for _, h := range route {
		cost, ok := g.enterCost(c, from, h, tick, laden, nil)
		if !ok || hex.Distance(from, h) != 1 {
			return nil, 0, refuse(NoRoute, "the route of %s does not run on from %s", x.ID, c.C.At.Ref())
		}
		total += cost
		from = h
	}
	if len(route) == 0 {
		return nil, 0, refuse(NoRoute, "the route of %s ends here", x.ID)
	}
	x.Cargo.Used = true
	return route, total, nil
}

// routeOf is the way a poster walked to where it stands, turned to lead
// away again: at most route-kept tiles, back to where it last stood here,
// for a Haul's hauler.
func (g *Game) routeOf(c *Char) []hex.Hex {
	trail := c.C.Trail
	if len(trail) > 0 && trail[len(trail)-1] == c.C.At {
		trail = trail[:len(trail)-1]
	}
	most := int(g.fp("route-kept"))
	var out []hex.Hex
	for i := len(trail) - 1; i >= 0 && len(out) < most && trail[i] != c.C.At; i-- {
		out = append(out, trail[i])
	}
	return out
}

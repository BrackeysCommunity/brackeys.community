package game

import (
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// The abilities parties, dungeons and tracks read (GDD 5.9). Each reads
// its ability's measure, so a rule row turns it on and nothing names an
// ability here. The Warden's and the Kindler's fight rules are in fight.

// holds reports whether a character's abilities raise a measure that
// counts from nothing.
func (g *Game) holds(c *Char, measure string) bool { return g.charScale(c, measure, 0) > 0 }

// trackWindow is how many ticks back the best tracker among these
// characters can follow a trail: the trail's own window, longer with
// Read the ground.
func (g *Game) trackWindow(cs ...*Char) int64 {
	base := g.trigger(TrigTrail).Window
	best := base
	for _, c := range cs {
		if c != nil {
			best = max(best, g.charScale(c, "track-ticks", base))
		}
	}
	return best
}

// longHunt reports whether a character can follow a fled creature to its
// tile (The long hunt).
func (g *Game) longHunt(c *Char) bool { return g.holds(c, "follow-fled") }

// Maps reports whether a character sees each way down at a fork as far
// as the next floor's first beat (Mapper).
func (g *Game) Maps(c *Char) bool { return g.holds(c, "fork-sight") }

// HoardSense reports whether a character sees a floor's pool of what fell
// there before entering it (Hoard sense).
func (g *Game) HoardSense(c *Char) bool { return g.holds(c, "floor-sight") }

// leaveTicks is how long climbing out of a delve takes a character: no
// time at all with Pack light.
func (g *Game) leaveTicks(c *Char) int64 {
	if g.holds(c, "free-exit") {
		return 0
	}
	return g.r.Fight.Param("leave-ticks")
}

// keyMaker reports whether a character can make a key for a dungeon
// whose bottom it has reached (Key-maker).
func (g *Game) keyMaker(c *Char) bool { return g.holds(c, "keys") }

// wayBack reports whether a character carries someone up without a beat
// a floor (The way back).
func (g *Game) wayBack(c *Char) bool { return g.holds(c, "carry-floors") }

// routeBand is the route-risk band a party's leader is ambushed at on
// entering a tile: the worst among the leader and its followers there,
// unless the leader holds Convoy and the party shares the leader's own.
func (g *Game) routeBand(c *Char, h hex.Hex) (sheets.RouteRisk, int, bool) {
	b, i, ok := g.riskBand(c, h)
	p := g.partyOf(c)
	if !ok || p == nil || p.Leader != c.C.ID || g.holds(c, "party-ambush-band") {
		return b, i, ok
	}
	for _, m := range p.Members {
		f := g.Char(m.ID)
		if !m.Follows || f == nil || f.C.At != h || f.C.Floor != c.C.Floor {
			continue
		}
		if fb, fi, fok := g.riskBand(f, h); fok && fi > i {
			b, i = fb, fi
		}
	}
	return b, i, ok
}

// mountUpkeep is what a character's mount costs on the road: less for
// its own abilities, or for any party member's (Caravan master).
func (g *Game) mountUpkeep(c *Char, base int64) int64 {
	owe := g.charScale(c, "mount-upkeep", base)
	if p := g.partyOf(c); p != nil {
		for _, m := range p.Members {
			if o := g.Char(m.ID); o != nil && o != c {
				owe = min(owe, g.charScale(o, "mount-upkeep", base))
			}
		}
	}
	return owe
}

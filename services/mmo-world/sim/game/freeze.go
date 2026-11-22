package game

import (
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/world"
)

// freezeCommand runs world.Freeze over the tiles characters stand on or
// are about to discover too, and the entrances open Reach goals name,
// whose floors were checked against the native plan. The service sends it
// once, at open; it is recorded like any command, so old ticks replay as
// they ran.
func (g *Game) freezeCommand(Command) error {
	var extra []hex.Hex
	for _, a := range g.Pending {
		if a.Kind == world.ActDiscover || a.Kind == world.ActVisit {
			extra = append(extra, a.Hex)
		}
	}
	for _, c := range g.Chars {
		extra = append(extra, c.C.At)
	}
	for _, x := range g.Goals {
		if x.Open() && x.Cond.Verb == goal.Reach && x.Cond.Dungeon != "" {
			if h, ok := hex.ParseRef(x.Cond.Dungeon); ok {
				extra = append(extra, h)
			}
		}
	}
	_, err := g.World.Freeze(g.Log, extra)
	return refusedFrom(err)
}

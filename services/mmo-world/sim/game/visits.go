package game

import (
	"slices"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// tileEntered is everything the story does when a character enters a
// tile: NPCs who want a word come to it, then patterns are reached.
func (g *Game) tileEntered(c *Char, h hex.Hex, t int64) error {
	if g.Story == nil {
		return nil
	}
	if err := g.callAt(c, h, t); err != nil {
		return err
	}
	return g.reachPattern(c, h, t)
}

// callAt brings each NPC with a visit queued for the character whose home
// or a route stop lies within visit-range of h to call on it there (GDD
// 4.18). Callers stay on the tile until the character moves on; one still
// in range of the next tile walks along without calling again. Only the
// queue is read, so the cost is visit-kept NPCs, not every saved one.
func (g *Game) callAt(c *Char, h hex.Hex, t int64) error {
	reach := g.r.NPC.Param("visit-range")
	prev := c.Callers
	var next []Caller
	for _, n := range g.NPCs.Visiting(c.C.ID) {
		if !nearRoute(n, h, reach) {
			continue
		}
		i := slices.IndexFunc(prev, func(x Caller) bool { return x.NPC == n.Stub.ID })
		if i >= 0 {
			next = append(next, Caller{NPC: n.Stub.ID, At: h, Tick: prev[i].Tick})
			continue
		}
		next = append(next, Caller{NPC: n.Stub.ID, At: h, Tick: t})
		if _, err := g.factWith(c, []fact.Ref{npc.Ref(n.Stub.ID)}, "npc.called", t, fact.At(h)...); err != nil {
			return err
		}
	}
	c.Callers = next
	return nil
}

// nearRoute reports whether an NPC's home or a stop of its route lies
// within reach of h.
func nearRoute(n *npc.NPC, h hex.Hex, reach int64) bool {
	if hex.Distance(n.Stub.Home, h) <= reach {
		return true
	}
	return slices.ContainsFunc(n.Route, func(s hex.Hex) bool { return hex.Distance(s, h) <= reach })
}

// calling is the NPC calling on a character at h, if one is.
func (c *Char) calling(id string, h hex.Hex) bool {
	return h == c.C.At && slices.ContainsFunc(c.Callers, func(x Caller) bool { return x.NPC == id && x.At == h })
}

// queueVisit queues an NPC's visit to a character. Under a season at most
// visit-kept stand queued, a new one displacing the lowest-numbered NPC
// queued, since visits keep no tick to lapse by.
func (g *Game) queueVisit(n *npc.NPC, c *Char) error {
	if g.Story != nil && !slices.Contains(n.Visits, c.C.ID) {
		if q := g.NPCs.Visiting(c.C.ID); len(q) > 0 && int64(len(q)) >= g.r.NPC.Param("visit-kept") {
			g.NPCs.Visited(q[0], c.C.ID)
			if err := g.NPCs.Touched(q[0]); err != nil {
				return err
			}
		}
	}
	g.NPCs.Queue(n, c.C.ID)
	return nil
}

// dormant reports whether an NPC sleeps. Under a season clock it has not
// been met nor remembered anything since the previous season began;
// without one, nobody has met it for dormant-days. Nothing ticks: it is
// asked only when someone meets, casts or queues it.
func (g *Game) dormant(n *npc.NPC, t int64) bool {
	from, ok := g.dormantFrom()
	if !ok {
		return g.r.NPC.Dormant(n, t)
	}
	if !g.r.NPC.DormantSince(n, from) {
		return false
	}
	return !slices.ContainsFunc(n.Memory, func(e npc.Entry) bool { return e.Tick >= from })
}

// dormantFrom is the tick the previous season began, under a clock. Every
// season after the first lasts season-days, and the first begins on day 0.
func (g *Game) dormantFrom() (int64, bool) {
	if g.Story == nil || g.Story.Clock == nil {
		return 0, false
	}
	return max(0, g.Story.Clock.Start-g.r.Story.SeasonDays) * sheets.TicksPerDay, true
}

// wake wakes a dormant NPC and reports whether it slept. Under a season it
// keeps its oldest dormant-summary entries, tallies the rest and writes
// npc.woke; without one it folds its memory. The caller chains the NPC.
func (g *Game) wake(n *npc.NPC, t int64) (bool, error) {
	if !g.dormant(n, t) {
		return false, nil
	}
	if g.Story == nil {
		g.r.NPC.Wake(n)
		return true, nil
	}
	if len(n.Memory) == 0 {
		return false, nil
	}
	all := len(n.Memory) + len(n.Archived)
	g.r.NPC.WakeKeeping(n, int(g.r.NPC.Param("dormant-summary")))
	kept := int64(len(n.Archived))
	return true, g.npcWoke(n, t, kept, int64(all)-kept)
}

// npcWoke writes an NPC's waking at its home.
func (g *Game) npcWoke(n *npc.NPC, t, kept, folded int64) error {
	region := ""
	if r := g.World.RegionAt(n.Stub.Home); r >= 0 {
		region = world.RegionRef(r)
	}
	data := append([]fact.Datum{fact.N("kept", kept), fact.N("folded", folded)}, fact.At(n.Stub.Home)...)
	f, err := g.r.weights.New(t, "npc.woke", region, []fact.Ref{npc.Ref(n.Stub.ID)}, nil, data...)
	if err != nil {
		return err
	}
	_, err = g.Log.Append(f)
	return err
}

package game

import (
	"cmp"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Built is the structures that went up in a region on a world day. NPCs
// read crowding from these counters, never from the fact log (GDD 4.18).
type Built struct {
	Region int   `json:"region"`
	Day    int64 `json:"day"`
	N      int64 `json:"n"`
}

func cmpBuilt(a, b Built) int {
	return cmp.Or(cmp.Compare(a.Region, b.Region), cmp.Compare(a.Day, b.Day))
}

// Fact kinds that put structures up, and the entry a neighbour keeps of
// one who moved.
const (
	factRaised  = "structure.raised"
	factFounded = "settlement.founded"
	entryMoved  = "moved-away"
	whyCrowding = "crowding"
)

// countBuilt counts a fact's structures towards its region's crowding. A
// build that leaves the region crowded marks its settlement, whose
// residents decide at the next tick whether to move home.
func (g *Game) countBuilt(f fact.Fact) {
	var n int64
	switch f.Kind {
	case factRaised:
		n = 1
	case factFounded:
		n = int64(len(settle.Charter(g.r.Book.Structures)))
	}
	d, ok := f.Get("settlement")
	if n == 0 || !ok || d.N < 0 || d.N >= int64(len(g.Places)) {
		return
	}
	place := int(d.N)
	region := g.World.RegionAt(g.Places[place].Hex)
	if region < 0 {
		return
	}
	day := f.Tick / sheets.TicksPerDay
	since := day - g.r.NPC.Param("crowding-days")
	g.Built = slices.DeleteFunc(g.Built, func(b Built) bool { return b.Day <= since })
	at := Built{Region: region, Day: day}
	i, found := slices.BinarySearchFunc(g.Built, at, cmpBuilt)
	if !found {
		g.Built = slices.Insert(g.Built, i, at)
	}
	g.Built[i].N += n
	if line := g.crowdLine(); line > 0 && g.BuiltIn(region, day) >= line {
		if j, marked := slices.BinarySearch(g.Crowded, place); !marked {
			g.Crowded = slices.Insert(g.Crowded, j, place)
		}
	}
}

// BuiltIn is how many structures went up in a region within crowding-days
// of a world day.
func (g *Game) BuiltIn(region int, day int64) int64 {
	since := day - g.r.NPC.Param("crowding-days")
	i, _ := slices.BinarySearchFunc(g.Built, Built{Region: region, Day: since + 1}, cmpBuilt)
	var n int64
	for ; i < len(g.Built) && g.Built[i].Region == region && g.Built[i].Day <= day; i++ {
		n += g.Built[i].N
	}
	return n
}

// crowdLine is the crowding topic's line: a region with that many
// structures built in the window is crowded.
func (g *Game) crowdLine() int64 {
	for _, row := range g.r.NPC.Topics() {
		if row.When == whenCrowding {
			return row.AtLeast
		}
	}
	return 0
}

// crowded reports whether a tile's region is crowded on a world day.
func (g *Game) crowded(h hex.Hex, day int64) bool {
	r := g.World.RegionAt(h)
	line := g.crowdLine()
	return r >= 0 && line > 0 && g.BuiltIn(r, day) >= line
}

// crowdTurn decides, for each settlement building has just left crowded,
// which of its residents move home: a keyed roll each for those their
// place can spare. Moves are decided here, at the event, never by ticking
// NPCs (GDD 4.18).
func (g *Game) crowdTurn(t int64) error {
	places := g.Crowded
	g.Crowded = nil
	chance := g.r.NPC.ParamF("move-chance")
	for _, place := range places {
		for _, n := range g.NPCs.Homed(g.Places[place].Hex) {
			role := g.r.NPC.Role(n.Stub.Role)
			if role == nil || role.Rooted || !g.r.draw.Roll(chance, "npc.move", draw.Str(n.Stub.ID), draw.Int(t)) {
				continue
			}
			if err := g.moveHome(n, t, whyCrowding); err != nil {
				return err
			}
		}
	}
	return nil
}

// moveHome moves an NPC to a quieter home, if one is in range: a fact,
// and something its former neighbours remember.
func (g *Game) moveHome(n *npc.NPC, t int64, why string) error {
	from := n.Stub.Home
	to, ok := g.quieter(n, t)
	if !ok {
		return nil
	}
	left := g.neighbours(n)
	old := n.Route
	g.r.NPC.Move(n, to, t, g.routeCost)
	g.NPCs.Routed(n, old)
	region := ""
	if r := g.World.RegionAt(from); r >= 0 {
		region = world.RegionRef(r)
	}
	f, err := g.r.weights.New(t, "npc.moved", region, []fact.Ref{npc.Ref(n.Stub.ID)}, nil,
		append(fact.At(from), fact.S("why", why), fact.S("to", to.Ref()))...)
	if err != nil {
		return err
	}
	id, err := g.Log.Append(f)
	if err != nil {
		return err
	}
	gone := npc.Entry{Kind: entryMoved, Weight: g.r.NPC.Param("moved-weight"), Tick: t, Fact: int64(id), Thing: n.Stub.Name + ", for " + g.placeName(to)}
	for _, o := range left {
		g.r.NPC.Remember(o, gone, t)
		if err := g.NPCs.Touched(o); err != nil {
			return err
		}
	}
	return g.NPCs.Touched(n)
}

// quieter is where a moving NPC goes: the nearest other settlement in
// range whose region is not crowded, else a keyed pick of open ground in
// such a region on the nearest ring that has any.
func (g *Game) quieter(n *npc.NPC, t int64) (hex.Hex, bool) {
	home, day := n.Stub.Home, t/sheets.TicksPerDay
	reach, most := g.r.NPC.Param("move-reach"), g.r.NPC.Param("move-range")
	var best hex.Hex
	found := false
	for _, p := range g.Places {
		d := hex.Distance(p.Hex, home)
		if d == 0 || d > most || g.crowded(p.Hex, day) {
			continue
		}
		if !found || d < hex.Distance(best, home) {
			best, found = p.Hex, true
		}
	}
	if found {
		return best, true
	}
	for r := reach; r <= most; r++ {
		var open []hex.Hex
		for _, h := range hex.Ring(home, r) {
			b := g.r.Gen.Baseline(h)
			if b.Site == "" && g.r.Gen.Passable(b.Terrain) && g.World.RegionAt(h) >= 0 && !g.crowded(h, day) {
				open = append(open, h)
			}
		}
		if len(open) > 0 {
			return open[g.r.draw.Below(uint64(len(open)), "npc.move-to", draw.Str(n.Stub.ID), draw.Int(t))], true
		}
	}
	return hex.Hex{}, false
}

// neighbours are the other saved NPCs of an NPC's settlement: those whose
// home is its home. An NPC living outside a settlement has none.
func (g *Game) neighbours(n *npc.NPC) []*npc.NPC {
	home := n.Stub.Home
	if !g.IsSettlement(home) {
		return nil
	}
	return slices.DeleteFunc(g.NPCs.Homed(home), func(o *npc.NPC) bool { return o == n })
}

// relay relays an NPC's route if its week is up, and re-indexes it.
func (g *Game) relay(n *npc.NPC, t int64) {
	old := n.Route
	if g.r.NPC.Relay(n, t, g.routeCost) {
		g.NPCs.Routed(n, old)
	}
}

// gossip is the line an NPC passes on about a neighbour and how salient
// it is: the neighbour's memory, named to the character it is about as
// "you" and to anyone else as a traveller.
func (g *Game) gossip(c *Char, n *npc.NPC, t int64) (string, int64, bool) {
	who, e, heard, ok := g.r.NPC.Heard(g.neighbours(n), t)
	if !ok {
		return "", 0, false
	}
	line, _ := g.r.NPC.GossipLine(e.Kind)
	about := "a traveller"
	if e.Player == c.C.ID {
		about = "you"
	}
	return npc.Line(line, npc.Field{Key: "neighbour", Value: who.Stub.Name}, npc.Field{Key: "who", Value: about},
		npc.Field{Key: "thing", Value: e.Thing}, npc.Field{Key: "n", Value: strconv.FormatInt(e.N, decimal)}), heard, true
}

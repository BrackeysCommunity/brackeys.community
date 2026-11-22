package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// Climb is the long action of climbing out of a dungeon to its entrance.
const Climb = "climb"

// structural: floor 1 is entered by no way; the tag a haunted dungeon
// puts on its floors.
const (
	noWay       = -1
	tagHaunted  = tags.Tag("haunted")
	wayRecorded = 1 // a floor record keeps the way taken down from it, +1
)

func (g *Game) fp(id string) int64 { return g.r.Fight.Param(id) }

func (g *Game) tp(id string) int64 { return sheets.IntParam(g.r.Book.TileParams, id) }

func (g *Game) refillTicks() int64 { return g.r.wp("dungeon-refill-days") * sheets.TicksPerDay }

// floorRead reports whether floor n of the dungeon at h stands cleared and
// not yet refilled: floors refill on their own, a refill's time after
// each was cleared.
func (g *Game) floorRead(h hex.Hex, n int64) bool {
	t := g.World.Tile(h)
	return t != nil && t.Dungeon.Cleared(n, g.Tick(), g.refillTicks())
}

// recordOf is the record of the dungeon at h, or nil while it has none.
func (g *Game) recordOf(h hex.Hex) *tile.Dungeon {
	if t := g.World.Tile(h); t != nil {
		return t.Dungeon
	}
	return nil
}

// enterFloor makes an encounter on a dungeon entrance a floor's: floor 1
// from the entrance, else the floor below the one its members stand on,
// by the way their fork sent them (GDD 4.9). Each member is on that floor
// from now, with what fell there to find.
func (g *Game) enterFloor(c *Char, b *beginning, site *fight.Site) error {
	h := c.C.At
	plan, ok := g.r.Gen.Dungeon(h)
	if !ok {
		return nil
	}
	members := b.members
	if len(members) == 0 {
		members = []*Char{c}
	}
	if f, _ := g.forkOf(c); f != nil {
		return refuse(Busy, "%s stands at the fork below floor %d: push on or leave", c.C.ID, f.Floor)
	}
	n, way := c.C.Floor+1, int64(noWay)
	if c.C.Floor > 0 && c.Delving != nil {
		way = c.Delving.Way
	}
	if n > plan.Floors {
		return refuse(NotHere, "%s stands on the bottom floor", c.C.ID)
	}
	fp := g.r.Gen.FloorAt(h, n, way, g.tierAt(h))
	site.Floor, site.Place = n, machinePlace(h, n)
	site.Tags = append(site.Tags, fp.Tags...)
	if d := g.recordOf(h); d != nil && d.Haunted {
		site.Tags = append(site.Tags, tagHaunted)
	}
	if err := g.partyTrigger(c, members, site); err != nil {
		return err
	}
	slices.Sort(site.Tags)
	site.Tags = slices.Compact(site.Tags)
	site.Beats, site.Half, site.Beyond, site.MixLock, site.Hidden = fp.Beats, fp.Step.Half, fp.Step.Beyond, true, fp.Hidden
	if fp.Bottom {
		site.Guardian = g.guardianPool(h, g.Tick())
	}
	if fp.Creature != "" {
		b.arch = fp.Creature
	}
	for _, m := range members {
		if m.Delving == nil || m.Delving.Dungeon != h.Ref() {
			m.Delving = &Delving{Dungeon: h.Ref(), Way: noWay}
		}
		m.C.Floor = n
		if n == firstFloor && m == c {
			if _, err := g.fact(c, "dungeon.entered", g.Tick(), append([]fact.Datum{fact.N("floor", n)}, fact.At(h)...)...); err != nil {
				return err
			}
		}
		if _, err := g.fact(m, "dungeon.reached", g.Tick(), append([]fact.Datum{fact.N("floor", n), fact.N("way", way), fact.S("kind", plan.Kind)}, fact.At(h)...)...); err != nil {
			return err
		}
		if err := g.floorFinds(m, h, n, ledger.SubKey(site.ID, "find", m.C.ID), site.Tags); err != nil {
			return err
		}
	}
	return nil
}

// carriedFrom adds what a floor encounter paid a delver to what it carries
// out of this delve, which goes to the floor's pool if it goes down
// before it is out (GDD 4.9).
func (g *Game) carriedFrom(c *Char, goods []item.Spoil) {
	if c.Delving == nil || c.C.Floor == 0 {
		return
	}
	for _, s := range goods {
		c.Delving.Carried = item.AddSpoil(c.Delving.Carried, s.Material, s.Qty)
	}
}

// floorClosed is what a floor encounter's end does to one member before the
// haul is paid: the floor cleared and its fork opened, or the member down on
// it with what it carried. with are the members whose fork bonus the close
// spends. Off a floor it only leaves a fled creature's track.
func (g *Game) floorClosed(c *Char, e *fight.Encounter, with []*Char) error {
	if err := g.fled(c, e); err != nil {
		return err
	}
	if e.Floor == 0 || c.Delving == nil {
		return nil
	}
	h := c.C.At
	if c.Delving.Climb > 0 {
		return g.carriedUp(c, e)
	}
	// The bonus grows the haul once, on the first member closed, and is
	// spent for every member closed with it.
	if bonus := c.Delving.Bonus; bonus > 0 {
		e.Haul = fight.GrowHaul(e.Haul, bonus)
		for _, m := range with {
			if m.Delving != nil {
				m.Delving.Bonus = 0
			}
		}
	}
	if slices.Contains(e.Gone, c.C.ID) {
		return g.climbGone(c, e)
	}
	if slices.Contains(e.Down, c.C.ID) || e.Result == fight.Lost {
		if e.Keeps(c.C.ID) {
			// Stood over: the fall counts, but what it carried stays with it.
			g.Pending = append(g.Pending, world.Action{Kind: world.ActFloorFell, Hex: h, By: char.Ref(c.C.ID), Floor: e.Floor})
			return nil
		}
		return g.downOnFloor(c, e.Floor, e.ID)
	}
	if e.Result != fight.Won {
		// Held off or got away: the floor still stands, and they climb out.
		return g.climbOut(c, ledger.SubKey(e.ID, "out", c.C.ID))
	}
	ref := h.Ref()
	if !g.pendingFloor(h, e.Floor, 0) {
		g.Pending = append(g.Pending, world.Action{Kind: world.ActFloorCleared, Hex: h, By: char.Ref(c.C.ID), Floor: e.Floor})
	}
	c.C.Deepest.Bump(ref, max(0, e.Floor-c.C.Deepest.Get(ref)))
	c.C.Deeds.Bump(DeedFloors, 1)
	if _, err := g.fact(c, "dungeon.floor-cleared", g.Tick(), append([]fact.Datum{fact.N("floor", e.Floor)}, fact.At(h)...)...); err != nil {
		return err
	}
	plan, _ := g.r.Gen.Dungeon(h)
	if e.Floor >= plan.Floors {
		return g.climbOut(c, ledger.SubKey(e.ID, "bottom"))
	}
	g.openFork(c, e.Floor)
	return nil
}

// pendingFloor reports whether a floor's record is already asked for this
// tick, with the same way: several members clear one floor together.
func (g *Game) pendingFloor(h hex.Hex, n, way int64) bool {
	return slices.ContainsFunc(g.Pending, func(a world.Action) bool {
		return a.Kind == world.ActFloorCleared && a.Hex == h && a.Floor == n && a.Way == way
	})
}

// downOnFloor leaves a delver down on floor n: what it carried out of this
// delve goes into the floor's pool, for What fell here, and the fall is
// counted for haunting (GDD 4.9).
func (g *Game) downOnFloor(c *Char, n int64, key string) error {
	h := c.C.At
	g.Pending = append(g.Pending, world.Action{Kind: world.ActFloorFell, Hex: h, By: char.Ref(c.C.ID), Floor: n})
	var lost []item.Spoil
	for _, s := range c.Delving.Carried {
		if q := min(s.Qty, g.balance(c, ledger.Material(s.Material))); q > 0 {
			lost = item.AddSpoil(lost, s.Material, q)
		}
	}
	c.Delving.Carried = nil
	if len(lost) == 0 {
		return nil
	}
	acc, pool := ledger.Char(c.C.ID), ledger.FloorPool(h.Ref(), n)
	var legs []ledger.Leg
	for _, s := range lost {
		legs = append(legs, ledger.Pair(acc, pool, ledger.Material(s.Material), s.Qty)...)
	}
	if err := g.receive(c, ledger.Txn{Key: ledger.SubKey(key, "carried", c.C.ID), Kind: "dropped", Tick: g.Tick(), Legs: legs}); err != nil {
		return err
	}
	g.remember(c, h, n, lost)
	return nil
}

// climbOut starts a delver climbing to the entrance: a long action of
// leave-ticks, or at once with Pack light.
func (g *Game) climbOut(c *Char, key string) error {
	n := g.leaveTicks(c)
	if n <= 0 {
		return g.outOfDungeon(c, g.Tick())
	}
	g.startLong(c, Climb, key, n, n)
	return nil
}

// leaveRecord takes a character out of its shared record and wakes the rest.
func (g *Game) leaveRecord(c *Char) {
	if sh := g.sharedOf(c); sh != nil {
		g.leaveShared(sh, c)
		g.saw(sh.Members...)
	}
}

// leaveFloorRecord is leaveRecord for a record on a dungeon's floor; an
// overland one is kept.
func (g *Game) leaveFloorRecord(c *Char) {
	if sh := g.sharedOf(c); sh != nil && sh.Floor > 0 {
		g.leaveShared(sh, c)
		g.saw(sh.Members...)
	}
}

// climbGone starts a member who backed out of a floor's encounter climbing out.
func (g *Game) climbGone(c *Char, e *fight.Encounter) error {
	return g.climbOut(c, ledger.SubKey(e.ID, "gone", c.C.ID))
}

// outOfDungeon stands a delver at the entrance, with whoever it carries up.
func (g *Game) outOfDungeon(c *Char, t int64) error {
	floor := c.C.Floor
	if c.Long != nil && c.Long.Kind == Climb {
		c.Long = nil
	}
	if d := g.Char(c.Carrying); d != nil && d.C.Floor > 0 {
		g.leaveFloorRecord(d)
		d.C.Floor, d.Delving = 0, nil
		g.touch(d)
	}
	c.C.Floor, c.Delving = 0, nil
	_, err := g.fact(c, "dungeon.left", t, append([]fact.Datum{fact.N("floor", floor)}, fact.At(c.C.At)...)...)
	return err
}

// delveTurn is a tick of the dungeons: climbs that are due end at the
// entrance, and a party's fork that everyone present has answered, or that
// nobody present is left at, resolves.
func (g *Game) delveTurn(tick int64) error {
	for _, c := range g.Chars {
		if c.Long == nil || c.Long.Kind != Climb || c.Long.Due > tick {
			continue
		}
		if err := g.outOfDungeon(c, tick); err != nil {
			return err
		}
		g.touch(c)
	}
	for _, sh := range slices.Clone(g.Shared) {
		if sh.Fork == nil {
			continue
		}
		if present := g.atFork(sh); len(present) == 0 || g.allChose(sh.Fork, present) {
			if err := g.resolveFork(sh, present, tick, nil); err != nil {
				return err
			}
		}
	}
	return nil
}

// delveDay is a world day of the dungeons: haunting comes and goes with
// the falls, and a dungeon its first slayers left unnamed is named by the
// pack.
func (g *Game) delveDay(day int64) error {
	now := day * sheets.TicksPerDay
	since := now - g.tp("haunted-days")*sheets.TicksPerDay
	for _, t := range g.World.Tiles {
		d := t.Dungeon
		if d == nil {
			continue
		}
		haunted := d.Falls(since) >= g.tp("haunted-falls")
		if haunted != d.Haunted {
			d.Haunted = haunted
			kind := "dungeon.calm"
			if haunted {
				kind = "dungeon.haunted"
			}
			if _, err := g.worldFact(t.Hex, kind, nil, nil, append([]fact.Datum{fact.N("falls", d.Falls(since))}, fact.At(t.Hex)...)...); err != nil {
				return err
			}
		}
		if err := g.nameDue(t.Hex, d, now); err != nil {
			return err
		}
	}
	return nil
}

// DeepestFloor is the deepest floor of the dungeon at h a character has
// cleared: a card shows the floors known so far, never the count.
func DeepestFloor(c *Char, h hex.Hex) int64 { return c.C.Deepest.Get(h.Ref()) }

// DungeonRead is a dungeon as a character at it sees it (GDD 4.9): the
// floor it stands on and the deepest it has reached, the bottom only once
// it stands there, and who lies down on its floor.
type DungeonRead struct {
	Dungeon string       `json:"dungeon"`
	Kind    string       `json:"kind"`
	Name    string       `json:"name,omitempty"`
	Up      bool         `json:"up,omitempty"`
	Floor   int64        `json:"floor"`
	Deepest int64        `json:"deepest"`
	Bottom  bool         `json:"bottom,omitempty"`
	Haunted bool         `json:"haunted,omitempty"`
	Downed  []string     `json:"downed,omitempty"`
	Fork    *ForkRead    `json:"fork,omitempty"`
	Pool    []item.Spoil `json:"pool,omitempty"` // Hoard sense: the next floor's
}

// DungeonOf is what a character on a dungeon entrance sees of it; false
// off one.
func (g *Game) DungeonOf(c *Char) (DungeonRead, bool) {
	h := c.C.At
	plan, ok := g.r.Gen.Dungeon(h)
	if !ok {
		return DungeonRead{}, false
	}
	out := DungeonRead{Dungeon: h.Ref(), Kind: plan.Kind, Name: g.DungeonName(h), Up: plan.Up, Floor: c.C.Floor,
		Deepest: DeepestFloor(c, h), Bottom: c.C.Floor > 0 && c.C.Floor >= plan.Floors}
	if d := g.recordOf(h); d != nil {
		out.Haunted = d.Haunted
	}
	for _, d := range g.CharsAt(h) {
		if d != c && d.C.Floor == c.C.Floor && notDown(d) != nil {
			out.Downed = append(out.Downed, d.C.ID)
		}
	}
	out.Fork = g.Fork(c)
	if !out.Bottom {
		out.Pool = g.FloorPoolSeen(c, h, c.C.Floor+1)
	}
	return out, true
}

// wayOf reads a way's option, "way-0" to "way-2".
func wayOf(option string) (int64, bool) {
	for w := int64(gen.WayOpen); w <= gen.WayHidden; w++ {
		if option == WayOption(w) {
			return w, true
		}
	}
	return 0, false
}

// WayOption is the option that pushes on down a way.
func WayOption(w int64) string { return "way-" + strconv.FormatInt(w, decimal) }

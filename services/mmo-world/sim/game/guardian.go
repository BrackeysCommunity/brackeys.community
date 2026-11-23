package game

import (
	"fmt"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
	"jams.team/mmo-world/sim/tile"
)

// A dungeon's guardian (GDD 4.9) is a health pool on its bottom floor's
// last beat that every party reaching it wears down in turn. Its window
// opens at the first press; unslain when it runs out, the guardian is
// whole again. Slain, it stays gone until the bottom floor refills. Each
// of its row's marks the pool falls past puts a machine on the beat,
// which, solved, makes the party's blows land harder.

// GuardianID is how facts and the ledger name a dungeon's guardian.
func GuardianID(h hex.Hex) string { return "hg-" + h.Ref() }

// guardianRow is a dungeon's plan and its guardian's hunts row.
func (g *Game) guardianRow(h hex.Hex) (gen.Plan, *sheets.Hunt, bool) {
	p, ok := g.Plan(h)
	if !ok || p.Guardian == "" {
		return p, nil, false
	}
	row, ok := g.r.Fight.Hunt(p.Guardian)
	return p, row, ok
}

// guardianNow is a guardian's record as it stands at tick; nil while it
// is whole, its window run out counting as whole.
func (g *Game) guardianNow(h hex.Hex, tick int64) *tile.Guardian {
	t := g.World.Tile(h)
	if t == nil || t.Dungeon == nil || t.Dungeon.Guardian == nil {
		return nil
	}
	gd := t.Dungeon.Guardian
	if gd.Slain == 0 && gd.Ends > 0 && tick >= gd.Ends {
		return nil
	}
	return gd
}

// guardianPool is the pool a bottom floor's last beat presses at tick:
// as worn as earlier parties left it, whole at the bottom floor's tier
// when nobody has pressed it this window, and none while it lies slain.
func (g *Game) guardianPool(h hex.Hex, tick int64) *fight.Pool {
	p, row, ok := g.guardianRow(h)
	if !ok {
		return nil
	}
	if gd := g.guardianNow(h, tick); gd != nil {
		if gd.Slain > 0 {
			return nil
		}
		return &fight.Pool{Health: gd.Health, Max: gd.Max}
	}
	pool, ok := g.r.Fight.GuardianPool(row.ID, g.r.Gen.Steps(g.tierAt(h), p.Floors-1).Tier)
	if !ok {
		return nil
	}
	return &pool
}

// attachPool puts the guardian's pool, as it stands now, on an encounter
// whose last beat is the guardian of the bottom floor of the dungeon at
// h. The pool is not saved with the encounter, so a press attaches it
// first; anything else is left alone.
func (g *Game) attachPool(h hex.Hex, e *fight.Encounter, tick int64) {
	if e == nil || !e.EndsOnGuardian() {
		return
	}
	if p, _, ok := g.guardianRow(h); ok && p.Floors == e.Floor {
		e.Pool = g.guardianPool(h, tick)
	}
}

// guardianPressed records what a press did to the guardian: the window
// opened at the first press, the pool worn or slain, and a machine staged
// on the beat for each mark passed. sh is nil for a lone delver. A press
// that did not reach the guardian's beat changes nothing.
func (g *Game) guardianPressed(h hex.Hex, e *fight.Encounter, sh *Shared, tick int64) error {
	if e.Pool == nil || !e.AtGuardian() || e.Guardian < 0 {
		return nil
	}
	_, row, ok := g.guardianRow(h)
	if !ok {
		return nil
	}
	d := g.World.DungeonAt(h)
	gd := g.guardianNow(h, tick)
	if gd == nil {
		gd = &tile.Guardian{Max: e.Pool.Max}
		d.Guardian = gd
	}
	if gd.Ends == 0 {
		gd.Ends = tick + g.r.Fight.Window(row.ID)
	}
	gd.Health = e.Pool.Health
	members := g.poolMembers(e, sh)
	g.saw(members...)
	subjects := append([]fact.Ref{huntRef(GuardianID(h))}, refsOf(members)...)
	data := append(fact.At(h), fact.S("row", row.ID), fact.S("archetype", row.Creature), fact.N("floor", e.Floor))
	switch {
	case gd.Health == 0:
		return g.guardianSlain(h, e, sh, row, members, subjects, data, tick)
	case e.Over:
		if gd.Health < gd.Max {
			return g.huntFact(tick, h, "guardian.worn", subjects, append(data, fact.N("health", gd.Health), fact.N("max", gd.Max))...)
		}
	default:
		g.markPassed(h, e, sh, row, gd)
	}
	return nil
}

// poolMembers are who is in the encounter pressing the pool: a shared
// encounter's members, or the lone delver whose fight it is.
func (g *Game) poolMembers(e *fight.Encounter, sh *Shared) []string {
	if sh != nil {
		return slices.Clone(sh.Members)
	}
	for _, c := range g.Chars {
		if c.Fight != nil && c.Fight.E == e {
			return []string{c.C.ID}
		}
	}
	return nil
}

// markPassed stages the guardian row's machine on the beat the first time
// the pool falls past each mark. A party works it; the bonus it earns is
// the machine path's to give.
func (g *Game) markPassed(h hex.Hex, e *fight.Encounter, sh *Shared, row *sheets.Hunt, gd *tile.Guardian) {
	n := g.r.Fight.Marks(row.ID, fight.Pool{Health: gd.Health, Max: gd.Max})
	if n <= gd.Marks {
		return
	}
	gd.Marks = n
	if sh == nil || sh.Machine != nil || row.Family == "" {
		return
	}
	w := puzzle.Where{Place: machinePlace(h, e.Floor), Beat: int64(e.At)}
	tier := e.Creature.Tier
	sh.Machine = &PartyMachine{Source: SourceGuardian, Spec: puzzle.Spec{Family: row.Family, Level: g.Puzzles().Level(row.Family, tier, 0, w),
		Tier: tier, Place: w.Place, Beat: w.Beat, Attempt: n - 1}}
}

// guardianSlain is the kill: the guardian lies slain until the bottom
// floor refills, its spoils roll once into its pool and are paid out as a
// won encounter's haul is split, carried out of the delve like it, and
// the first slayers become the namers.
func (g *Game) guardianSlain(h hex.Hex, e *fight.Encounter, sh *Shared, row *sheets.Hunt, members []string, subjects []fact.Ref, data []fact.Datum, tick int64) error {
	d := g.World.DungeonAt(h)
	gd := d.Guardian
	gd.Health, gd.Slain, gd.Ends = 0, tick, 0
	id := GuardianID(h)
	at := strconv.FormatInt(tick, decimal)
	key := ledger.SubKey("tick", at, "guardian", h.Ref())
	rolled := g.r.Fight.RollRow(row.ID, draw.Str(id), draw.Int(tick))
	pool := ledger.HuntPool(id)
	for i, s := range rolled {
		if err := g.post(ledger.Move(ledger.SubKey(key, "roll", strconv.Itoa(i)), "guardian", tick, ledger.FromHunt, pool, ledger.Material(s.Material), s.Qty)); err != nil {
			return err
		}
	}
	even := false
	if sh != nil {
		if p := g.PartyByID(sh.Party); p != nil {
			if l := g.Char(p.Leader); l != nil {
				even = g.EvenShares(l)
			}
		}
	}
	share := tally.Tally{}
	for _, who := range members {
		if !slices.Contains(e.Gone, who) {
			share.Bump(who, e.Share.Get(who))
		}
	}
	if even || share.Sum() == 0 {
		for i := range share {
			share[i].N = 1
		}
	}
	parts := fight.Split(rolled, share, g.r.Fight.SplitTie(id+"/"+at))
	for _, who := range members {
		c := g.Char(who)
		if c == nil {
			return fmt.Errorf("game: guardian %s was slain by %q, who is gone", id, who)
		}
		if len(parts[who]) == 0 {
			continue
		}
		for i, s := range parts[who] {
			if err := g.receive(c, ledger.Move(ledger.SubKey(key, "part", who, strconv.Itoa(i)), "guardian", tick, pool, ledger.Char(who), ledger.Material(s.Material), s.Qty)); err != nil {
				return err
			}
		}
		g.carriedFrom(c, parts[who])
		g.touchOnce(c)
	}
	for _, s := range rolled {
		data = append(data, fact.N("rolled:"+s.Material, s.Qty))
	}
	if err := g.huntFact(tick, h, "guardian.slain", g.withLead(g.firstOf(members), subjects), data...); err != nil {
		return err
	}
	return g.firstSlain(h, members, tick)
}

// guardiansTurn makes guardians whole: one whose window ran out unslain,
// and one slain once the bottom floor has refilled.
func (g *Game) guardiansTurn(tick int64) error {
	refill := g.refillTicks()
	for _, t := range g.World.Tiles {
		d := t.Dungeon
		if d == nil || d.Guardian == nil {
			continue
		}
		gd := d.Guardian
		p, row, ok := g.guardianRow(t.Hex)
		switch {
		case !ok:
			continue
		case gd.Slain > 0 && (tick < gd.Slain+refill || d.Cleared(p.Floors, tick, refill)):
			continue
		case gd.Slain == 0 && (gd.Ends == 0 || tick < gd.Ends):
			continue
		}
		d.Guardian = nil
		data := append(fact.At(t.Hex), fact.S("row", row.ID), fact.B("slain", gd.Slain > 0), fact.N("health", gd.Health), fact.N("max", gd.Max))
		if err := g.huntFact(tick, t.Hex, "guardian.whole", []fact.Ref{huntRef(GuardianID(t.Hex))}, data...); err != nil {
			return err
		}
	}
	return nil
}

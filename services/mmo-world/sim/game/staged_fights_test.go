package game

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// stagedFightGame is a world with servers a and b: a's admin and two of
// its players, all carrying knives, stand beside a's settlement.
func stagedFightGame(t *testing.T) (g *Game, stager *Char, players []*Char, home int, at hex.Hex) {
	t.Helper()
	g = guardGame(t)
	join := func(key, server, note string) *Char {
		res, err := g.Act(Command{Key: key, Kind: Create, Server: server, Note: note, Option: "knife"})
		if err != nil {
			t.Fatal(err)
		}
		return res.Char
	}
	stager = join("a1", "a", "Alder")
	join("b1", "b", "Birch")
	gd := g.ServerGuild("a")
	home = slices.IndexFunc(g.Places, func(p *Place) bool { return p.Guild == gd.G.ID })
	if home < 0 {
		t.Fatal("server a's guild runs no settlement")
	}
	at = besidePlace(t, g, home)
	players = []*Char{join("a2", "a", ""), join("a3", "a", "")}
	for _, c := range append([]*Char{stager}, players...) {
		if c.C.In(char.Hand, 0) == nil {
			t.Fatalf("%s carries no knife", c.C.ID)
		}
		c.C.At = at
	}
	return g, stager, players, home, at
}

// besidePlace is passable land in the awake regions next to settlement n,
// in its region.
func besidePlace(t *testing.T, g *Game, n int) hex.Hex {
	t.Helper()
	h := g.SettlementHex(n)
	for _, x := range h.Neighbours() {
		if g.r.Gen.Passable(g.r.Gen.Baseline(x).Terrain) && g.World.RegionAt(x) == g.World.RegionAt(h) {
			return x
		}
	}
	t.Fatal("no passable land beside the settlement")
	return hex.Hex{}
}

// liveStage adds an open stage of server a's, staged by stager.
func liveStage(g *Game, stager *Char, home int, at hex.Hex, template, kind, row string) *Stage {
	if g.Live == nil {
		g.Live = &LiveOps{}
	}
	g.Live.Next++
	t := g.Tick()
	st := &Stage{ID: fmt.Sprintf("st-%d", g.Live.Next), Template: template, Kind: kind, Server: "a", Role: RoleAdmin, By: stager.C.ID,
		Settlement: home, At: at, Opens: t, Ends: t + 2*sheets.TicksPerDay, Open: true, Hunt: row}
	g.Live.Stages = append(g.Live.Stages, st)
	return st
}

// xpOf is everything an item has gained, its levels counted back in.
func xpOf(g *Game, in *item.Instance) int64 {
	n := in.XP
	for l := range in.Level {
		n += g.r.Growth.ToNext(l)
	}
	return n
}

// pressFresh presses a hunt with the presser's gear and standing in it
// put back, so the press is always allowed.
func pressFresh(t *testing.T, g *Game, c *Char, x *Hunt, key string) {
	t.Helper()
	for _, in := range c.C.Pack {
		in.Repair()
	}
	x.H.Failures, x.H.Down, x.H.States = nil, nil, nil
	c.C.Conditions = nil
	if _, err := press(g, c, x, key); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
}

// TestStagedXPAllowance: a character pressing a staged hunt gains xp up
// to the day's allowance and then none; a new world day gives it back; an
// unstaged hunt still grants xp and spends none of it; the stager gains
// nothing from its own stage (GDD 14.5).
func TestStagedXPAllowance(t *testing.T) {
	g, stager, ps, home, at := stagedFightGame(t)
	limit := sheets.IntParam(g.r.Book.LiveOpsParams, "staged-xp")
	st := liveStage(g, stager, home, at, "hunt-2", sheets.StageHunt, quickHunt)
	if err := g.openStagedHunt(st, g.Tick()); err != nil {
		t.Fatal(err)
	}
	x := g.HuntByID(st.HuntID)
	if x == nil || x.Stage != st.ID || x.Why != WhyStaged || x.H.Creature.Tier != 2 || x.H.Ends != st.Ends {
		t.Fatalf("staged hunt: %+v", x)
	}
	c := ps[0]
	knife := c.C.In(char.Hand, 0)
	from := xpOf(g, knife)
	for n := 0; c.C.StagedXP < limit; n++ {
		if n > 60 || x.H.Over {
			t.Fatalf("after %d presses the allowance stands at %d of %d", n, c.C.StagedXP, limit)
		}
		pressFresh(t, g, c, x, fmt.Sprintf("a-%d", n))
	}
	if c.C.StagedXP != limit || c.C.StagedDay != g.Tick()/sheets.TicksPerDay {
		t.Fatalf("allowance used %d on day %d", c.C.StagedXP, c.C.StagedDay)
	}
	if knife.Level < g.r.Growth.Cap(1) {
		if got := xpOf(g, knife) - from; got != limit {
			t.Fatalf("the knife gained %d xp under an allowance of %d", got, limit)
		}
	}
	capped := xpOf(g, knife)
	for n := range 3 {
		pressFresh(t, g, c, x, fmt.Sprintf("b-%d", n))
	}
	if xpOf(g, knife) != capped || c.C.StagedXP != limit {
		t.Fatalf("pressing past the allowance gained %d xp", xpOf(g, knife)-capped)
	}

	c.C.StagedDay--
	pressFresh(t, g, c, x, "next-day")
	if xpOf(g, knife) == capped || c.C.StagedXP <= 0 || c.C.StagedXP >= limit || c.C.StagedDay != g.Tick()/sheets.TicksPerDay {
		t.Fatalf("a new day's allowance: used %d, gained %d", c.C.StagedXP, xpOf(g, knife)-capped)
	}

	sk := stager.C.In(char.Hand, 0)
	was := xpOf(g, sk)
	for n := range 3 {
		pressFresh(t, g, stager, x, fmt.Sprintf("s-%d", n))
	}
	if xpOf(g, sk) != was || stager.C.StagedXP != 0 {
		t.Fatalf("the stager gained %d xp from its own stage", xpOf(g, sk)-was)
	}

	other := ps[1]
	other.C.StagedXP, other.C.StagedDay = limit, g.Tick()/sheets.TicksPerDay
	world := openHuntAt(t, g, "walking-factory", at)
	ok := other.C.In(char.Hand, 0)
	was = xpOf(g, ok)
	pressFresh(t, g, other, world, "world")
	if xpOf(g, ok) == was || other.C.StagedXP != limit {
		t.Fatalf("an unstaged hunt gained %d xp and used the allowance to %d", xpOf(g, ok)-was, other.C.StagedXP)
	}

	// A gathering tool's xp is held to the same allowance while a stage
	// is applied.
	restore := g.withStage(st)
	other.C.StagedXP = limit - 1
	was = xpOf(g, ok)
	if err := g.levelledWithin(other, ok, limit, g.Tick()); err != nil {
		t.Fatal(err)
	}
	restore()
	if got := xpOf(g, ok) - was; ok.Level < g.r.Growth.Cap(1) && got != 1 || other.C.StagedXP != limit {
		t.Fatalf("a tool under the allowance gained %d and used it to %d", got, other.C.StagedXP)
	}
	audit(t, g)
}

// TestStagedHuntSpoils: a staged hunt's roll is minted from src:staged as
// staged goods of its settlement into its pool and split by health
// removed among everyone but the stager; it moves no population, gauge
// or spawn, and a stager alone brings home nothing.
func TestStagedHuntSpoils(t *testing.T) {
	g, stager, ps, home, at := stagedFightGame(t)
	st := liveStage(g, stager, home, at, "hunt-2", sheets.StageHunt, quickHunt)
	if err := g.openStagedHunt(st, g.Tick()); err != nil {
		t.Fatal(err)
	}
	x := g.HuntByID(st.HuntID)
	r := g.World.RegionAt(at)
	region := world.RegionRef(r)
	if g.openHunt(quickHunt, region) != nil {
		t.Fatal("a staged hunt reads as the world's open hunt of its row")
	}
	if _, err := g.OpenHunt(quickHunt, at, g.Tick(), WhyStaged); err != nil {
		t.Fatalf("the world's hunt of the row is held back by a staged one: %v", err)
	}
	if _, err := g.openHuntAs(quickHunt, at, g.Tick(), WhyStaged, huntOpening{stage: st.ID}); !refusedAs(err, OpenHunt) {
		t.Fatalf("a second staged hunt of the row: %v", err)
	}
	g.Hunts = slices.DeleteFunc(g.Hunts, func(h *Hunt) bool { return h.Stage == "" })

	gauges := slices.Clone(g.World.Regions[r].Gauge)
	pop := map[hex.Hex]int64{}
	species := x.H.Creature.Archetype
	tiles := g.r.Gen.RegionTiles(g.World.Regions[r].Lattice)
	for _, h := range tiles {
		pop[h] = g.World.Population(h, species)
	}
	minted := g.Ledger.Of(ledger.FromHunt, ledger.Material("hide-scraps"))
	x.H.Health = min(x.H.Health, 90)
	pressers := append([]*Char{stager}, ps...)
	for n := 0; !x.H.Over; n++ {
		if n > 200 {
			t.Fatal("the staged hunt never fell")
		}
		pressFresh(t, g, pressers[n%len(pressers)], x, fmt.Sprintf("k-%d", n))
	}
	if !x.H.Slain || len(x.Rolled) == 0 {
		t.Fatalf("slain %v, rolled %v", x.H.Slain, x.Rolled)
	}
	if want := g.r.Fight.Roll(x.H); !slices.Equal(want, x.Rolled) {
		t.Fatalf("rolled %v, the hunt's own draw %v", x.Rolled, want)
	}
	parts := g.HuntParts(x)
	if len(parts[stager.C.ID]) != 0 || len(stager.C.Staged) != 0 {
		t.Fatalf("the stager took %v, carries %v", parts[stager.C.ID], stager.C.Staged)
	}
	for _, s := range x.Rolled {
		stg := ledger.Staged(home, s.Material)
		var got int64
		for _, c := range ps {
			got += g.StagedHeld(c, home, s.Material)
		}
		if got != s.Qty || g.Ledger.Of(ledger.FromStaged, stg) != -s.Qty || g.Ledger.Of(ledger.HuntPool(x.H.ID), stg) != 0 {
			t.Fatalf("%s: rolled %d, held %d, minted %d", s.Material, s.Qty, got, -g.Ledger.Of(ledger.FromStaged, stg))
		}
		for _, c := range pressers {
			if goodsOf(c, s.Material) != 0 {
				t.Fatalf("%s carries clean %s from a staged hunt", c.C.ID, s.Material)
			}
		}
	}
	if g.Ledger.Of(ledger.FromHunt, ledger.Material("hide-scraps")) != minted {
		t.Fatal("the hunts source minted for a staged hunt")
	}
	if !slices.Equal(gauges, g.World.Regions[r].Gauge) {
		t.Fatalf("region gauges moved: %v to %v", gauges, g.World.Regions[r].Gauge)
	}
	for _, h := range tiles {
		if g.World.Population(h, species) != pop[h] {
			t.Fatalf("%s's population moved on %v", species, h)
		}
	}
	audit(t, g)

	alone := liveStage(g, stager, home, at, "hunt-2", sheets.StageHunt, quickHunt)
	if err := g.openStagedHunt(alone, g.Tick()); err != nil {
		t.Fatal(err)
	}
	y := g.HuntByID(alone.HuntID)
	y.H.Health = min(y.H.Health, 60)
	for n := 0; !y.H.Over; n++ {
		if n > 200 {
			t.Fatal("the stager's hunt never fell")
		}
		pressFresh(t, g, stager, y, fmt.Sprintf("alone-%d", n))
	}
	if !y.H.Slain || len(y.Rolled) != 0 || len(stager.C.Staged) != 0 {
		t.Fatalf("a stager alone: slain %v, rolled %v, carries %v", y.H.Slain, y.Rolled, stager.C.Staged)
	}
	audit(t, g)
}

// TestStagedHardship: each hardship casts its trouble by the server on the
// settlement until the stage ends, with no coin on its side and no hold on
// the place's own troubles. Lost, it moves no gauge, structure, count or
// fee; held, it pays its holders staged prizes, the stager none.
func TestStagedHardship(t *testing.T) {
	for _, template := range []string{"storm", "scare", "drill"} {
		t.Run(template, func(t *testing.T) {
			for _, hold := range []bool{true, false} {
				g, stager, ps, home, at := stagedFightGame(t)
				st := liveStage(g, stager, home, at, template, sheets.StageHardship, "")
				faction := g.Ledger.Of(ledger.FromFaction, ledger.Coin)
				p := g.Places[home]
				structures := slices.Clone(p.Structures)
				story := *g.placeStory(home)
				pending := len(g.Pending)
				if err := g.castHardship(st, g.Tick()); err != nil {
					t.Fatal(err)
				}
				a := g.arcByID(st.Arc)
				if a == nil || a.By != ByServer || a.Staging != st.ID || a.Place != goal.SettlementRef(home) || g.placeTaken(home) {
					t.Fatalf("hardship arc: %+v", a)
				}
				if err := g.castHardship(st, g.Tick()); !refusedAs(err, SlotBusy) {
					t.Fatalf("a second staged hardship at the place: %v", err)
				}
				side := sideNamed(t, a, sideHold)
				x := g.GoalOf(side.Goal)
				if x.Reward != 0 || a.Stages[0].Due != st.Ends || g.Ledger.Of(ledger.FromFaction, ledger.Coin) != faction {
					t.Fatalf("hardship side: reward %d, due %d of %d", x.Reward, a.Stages[0].Due, st.Ends)
				}
				if template == "drill" {
					h := g.HuntByID(a.Hunt)
					if h == nil || h.Stage != st.ID || h.Why != WhyStaged {
						t.Fatalf("drill's raid hunt: %+v", h)
					}
				}
				for _, c := range append([]*Char{stager}, ps...) {
					x.Progress.Bump(c.C.ID, 1)
				}
				aligned := slices.Clone(ps[0].C.Flags)
				won := ""
				if hold {
					won = sideHold
				}
				if err := g.endStage(a, won, g.Tick()); err != nil {
					t.Fatal(err)
				}
				if !a.over() || len(g.Story.Rests) != 0 && slices.ContainsFunc(g.Story.Rests, func(r ScopeRest) bool { return r.Ref == arc.SettlementRef(home) }) {
					t.Fatalf("the hardship did not end, or rested the place: %+v", a)
				}
				if got := *g.placeStory(home); got.Held != story.Held || got.Lost != story.Lost || got.Fees != story.Fees ||
					got.Orders != story.Orders || got.Prices != story.Prices || got.Sick != story.Sick || got.Followed != story.Followed {
					t.Fatalf("the place's story moved: %+v to %+v", story, got)
				}
				if !slices.Equal(structures, p.Structures) {
					t.Fatalf("structures moved: %+v to %+v", structures, p.Structures)
				}
				for _, act := range g.Pending[pending:] {
					if act.Kind == world.ActGauge || act.Kind == world.ActFallHolding {
						t.Fatalf("a hardship queued %+v", act)
					}
				}
				if !slices.Equal(aligned, ps[0].C.Flags) || ps[0].C.Alignment != nil {
					t.Fatalf("holding a hardship moved alignment: %+v", ps[0].C.Alignment)
				}
				if template == "drill" {
					if h := g.HuntByID(a.Hunt); h != nil && !h.H.Over {
						t.Fatal("the drill's hunt outlived it")
					}
				}
				if len(stager.C.Staged) != 0 {
					t.Fatalf("the stager took %v", stager.C.Staged)
				}
				for _, c := range ps {
					if hold != (len(c.C.Staged) == 1 && c.C.Staged[0].At == home) {
						t.Fatalf("held %v: %s carries %v", hold, c.C.ID, c.C.Staged)
					}
				}
				audit(t, g)
			}
		})
	}
}

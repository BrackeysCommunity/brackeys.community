package game

import (
	"encoding/json"
	"slices"
	"strconv"
	"testing"

	"jams.team/mmo-world/sim/align"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// structural: how many world days the scripted thief may take to be
// invited, and how many burglaries it tries a day (the Crime run's daily
// pattern).
const (
	thiefDays     = 60
	thiefPerDay   = 3
	thiefStoreLow = 10
	thiefStockLow = 40
)

// TestScriptedThief walks one character from its first burglary to the
// syndicate's grudge (GDD 4.5, 5.10, 12.9): it burgles and fences daily
// until the invitation is cast, takes the job at the fence, meets a watch
// captain while made until the informer is cast, and names the fence. It
// ends betrayed, unmade and held at the grudge by every den's fence and
// every syndicate notable. The audit holds after every step.
func TestScriptedThief(t *testing.T) {
	g, near := informerGame(t)
	c, d := atDen(t, g, "thief")
	id := c.C.ID
	// The first faction holds the den's region, so its store is what a
	// burglary there takes from; the store is kept stocked so the run
	// measures the thief, not the economy.
	g.World.Regions[g.World.RegionAt(c.C.At)].Holder = 0
	tier := g.tierAt(c.C.At)
	mat := ""
	for _, m := range g.r.Book.Materials {
		if m.Tier == tier {
			mat = m.ID
			break
		}
	}
	if mat == "" {
		t.Fatalf("no material of tier %d", tier)
	}

	first, thefts, fenced := int64(-1), 0, int64(0)
	for day := 0; day < thiefDays && threadOf(g, c, inviteTemplate) == nil; day++ {
		for range thiefPerDay {
			f := &g.World.Factions[0]
			f.Fallen = false
			f.Stock = max(f.Stock, thiefStockLow)
			if have := g.Ledger.Of(ledger.StorePool(0), ledger.Material(mat)); have < thiefStoreLow {
				fund(t, g, ledger.StorePool(0), ledger.Material(mat), thiefStoreLow-have)
			}
			mendWorn(t, g, c, thefts)
			g2, c2, tf := pressTo(t, g, id, Command{Kind: Steal, Option: KindBurgle}, 0, theftWon, nil)
			g, c = g2, c2
			thefts++
			if first < 0 {
				first = tf.Tick / sheets.TicksPerDay
			}
			if datum(tf, "kind").S != KindBurgle || datum(tf, "witnessed").N != 0 {
				t.Fatalf("the burglary told as %+v", tf.Data)
			}
			audit(t, g)
			hot := g.HotUnits(c, mat, g.Tick()/sheets.TicksPerDay)
			for hot > 0 && g.FencePays(c, g.WorthAt(c.C.At, ledger.Material(mat), hot)) > g.Market.Trader[d.Place] {
				hot--
			}
			if hot > 0 && g.FenceVisible(c) {
				coin := c.C.Coin
				if _, err := g.Act(Command{Key: "fence-" + strconv.Itoa(thefts), Char: id, Kind: Fence, Material: mat, Units: hot}); err != nil {
					t.Fatalf("day %d: the fence refused %d units: %v", day, hot, err)
				}
				fenced += c.C.Coin - coin
				audit(t, g)
			}
		}
		for next := (g.Tick()/sheets.TicksPerDay + 1) * sheets.TicksPerDay; g.Tick() < next && threadOf(g, c, inviteTemplate) == nil; {
			dirTick(t, g)
		}
		audit(t, g)
	}

	invite := threadOf(g, c, inviteTemplate)
	if invite == nil {
		t.Fatalf("the invitation never cast: %d thefts, %d coin fenced, standing %d", thefts, fenced, c.C.Standing.Get(syndicateKey))
	}
	t.Logf("invited %d world days after the first theft: %d thefts, %d coin fenced, standing %d, alignment %d",
		invite.Began/sheets.TicksPerDay-first, thefts, fenced, c.C.Standing.Get(syndicateKey), AlignmentOf(c))
	if who, _ := invite.Cast.Get(roleThreadNPC); who != npc.Ref(d.Fence) {
		t.Fatalf("the invitation casts %v, not the den's fence %s", who, d.Fence)
	}
	c.C.At = d.At
	talkTo(t, g, c, d.Fence)
	if _, err := g.Act(Command{Key: "take", Char: id, Kind: Choose, NPC: d.Fence, Option: inviteTemplate + "/" + sideTakeTheJob}); err != nil {
		t.Fatal(err)
	}
	advanceUntil(t, g, 2, invite.over)
	made := factsOf(g, factMade)
	if invite.Outcome != sideTakeTheJob || !char.IsMade(c.C) || len(made) != 1 || !slices.Contains(made[0].Subjects, char.Ref(id)) {
		t.Fatalf("taking the job: outcome %q, made %v, %d syndicate.made", invite.Outcome, char.IsMade(c.C), len(made))
	}
	audit(t, g)

	// While made it meets every den's fence and every notable, so each is
	// saved and its conversation can be read once the grudge holds.
	syndicate := meetSyndicate(t, g, c)
	c.C.At = d.At
	fenceBefore := g.NPCs.Get(d.Fence)
	if fenceBefore == nil {
		t.Fatal("the den's fence is not saved")
	}
	kept := npcMemory(t, fenceBefore)

	before := AlignmentOf(c)
	informer, den := informerOf(t, g, c)
	if den.Fence != d.Fence {
		t.Fatalf("the informer names den %+v, not the thief's %+v", den, d)
	}
	captain, _ := informer.Cast.Get(roleThreadNPC)
	talkTo(t, g, c, captain.ID)
	if _, err := g.Act(Command{Key: "inform", Char: id, Kind: Choose, NPC: captain.ID, Option: informerTemplate + "/name-the-fence"}); err != nil {
		t.Fatal(err)
	}
	advanceUntil(t, g, 2, informer.over)
	audit(t, g)
	if informer.Outcome != "name-the-fence" {
		t.Fatalf("the informer ended %q", informer.Outcome)
	}

	betrayed := factsOf(g, factBetrayed)
	if len(betrayed) != 1 || datum(betrayed[0], "faction").S != syndicateKey || !slices.Contains(betrayed[0].Subjects, standingRef(syndicateKey)) {
		t.Fatalf("betrayals %+v", betrayed)
	}
	if s := c.C.Standing.Get(syndicateKey); s > sheets.IntParam(g.r.Book.TheftParams, "betrayal-standing") {
		t.Fatalf("syndicate standing %d after the betrayal", s)
	}
	if char.IsMade(c.C) || len(factsOf(g, factUnmade)) != 1 {
		t.Fatal("the informer is still made")
	}

	p := g.AlignParams()
	informed, betrayal := alignMoves(g, c, ActInformed), alignMoves(g, c, ActBetrayal)
	if len(informed) != 1 || len(betrayal) != 1 || informed[0].ID >= betrayal[0].ID {
		t.Fatalf("informing and the betrayal told as %d and %d facts", len(informed), len(betrayal))
	}
	up, down := g.actMove(ActInformed, 0), g.actMove(ActBetrayal, 0)
	plus := align.Clamp(p, before+align.Deepen(p, before, up)) - before
	minus := align.Clamp(p, before+plus+align.Deepen(p, before+plus, down)) - (before + plus)
	for _, m := range []struct {
		f            fact.Fact
		asked, delta int64
	}{{informed[0], up, plus}, {betrayal[0], down, minus}} {
		if datum(m.f, "asked").N != m.asked || datum(m.f, "delta").N != m.delta {
			t.Fatalf("%s asked %d moved %d, want %d and %d", datum(m.f, "act").S, datum(m.f, "asked").N, datum(m.f, "delta").N, m.asked, m.delta)
		}
	}
	if AlignmentOf(c) != before+plus+minus {
		t.Fatalf("alignment %d, want %d", AlignmentOf(c), before+plus+minus)
	}
	t.Logf("alignment %d +%d %d -> %d; standing %d", before, plus, minus, AlignmentOf(c), c.C.Standing.Get(syndicateKey))

	day := g.Tick() / sheets.TicksPerDay
	grudges := char.GrudgesOf(c.C)
	if gi := slices.IndexFunc(grudges, func(gr char.Grudge) bool { return gr.Faction == syndicateKey }); gi < 0 ||
		grudges[gi].Ends != betrayed[0].Tick/sheets.TicksPerDay+sheets.IntParam(g.r.Book.TheftParams, "grudge-days") {
		t.Fatalf("grudges %+v, betrayed on day %d", grudges, betrayed[0].Tick/sheets.TicksPerDay)
	}
	if !c.GrudgeWith(syndicateKey, day) {
		t.Fatal("no live grudge")
	}

	if !movedFor(g, d, denMoveInformed) {
		t.Fatalf("the den did not move: %+v", g.Syndicate)
	}
	moved, ok := g.DenAt(near.Hex)
	if !ok || moved.Fence != d.Fence {
		t.Fatalf("the den is not at %v: %+v", near.Hex, g.Dens())
	}
	fenceAfter := g.NPCs.Get(d.Fence)
	if fenceAfter.Stub.Home != near.Hex || fenceAfter.Leaning != fenceBefore.Leaning {
		t.Fatalf("the moved fence is homed at %v leaning %q", fenceAfter.Stub.Home, fenceAfter.Leaning)
	}
	if after := npcMemory(t, fenceAfter); !keeps(after, kept) {
		t.Fatalf("the moved fence forgot: before %+v, after %+v", kept, after)
	}

	grudge := g.r.NPC.Param("grudge-disposition")
	everyone := syndicateIDs(g)
	t.Logf("%d den fences and notables hold the grudge", len(everyone))
	for _, who := range everyone {
		if !slices.Contains(syndicate, who) {
			t.Fatalf("%s was never met", who)
		}
		if got := g.Disposition(c, who); got != grudge {
			t.Fatalf("%s holds the informer at %d, want %d", who, got, grudge)
		}
		conv, err := g.Converse(c, who)
		if err != nil {
			t.Fatalf("%s: %v", who, err)
		}
		if len(conv.Topics) != 1 || conv.Topics[0].ID != whenTurnedAway {
			t.Fatalf("%s offers %+v", who, conv.Topics)
		}
	}
	audit(t, g)
}

// mendWorn repairs whatever the character wears that has worn, granting
// the repair's materials: a knife breaks within days of daily burglary.
func mendWorn(t *testing.T, g *Game, c *Char, n int) {
	t.Helper()
	for _, in := range c.C.Pack {
		if !c.C.Worn(in.ID) || (in.Durability >= in.MaxDurability && !in.Dormant) {
			continue
		}
		k, ok := g.Kinds.Kind(in.Kind)
		if !ok {
			continue
		}
		if cost := g.RepairCost(in, k); cost.Units > 0 {
			grantFor(t, g, c, ledger.Material(cost.Material), cost.Units)
		}
		if _, err := g.Act(Command{Key: "mend-" + strconv.Itoa(n) + "-" + in.ID, Char: c.C.ID, Kind: Repair, Item: in.ID}); err != nil {
			t.Fatalf("repairing %s: %v", in.ID, err)
		}
		audit(t, g)
	}
}

// syndicateIDs are every den's fence and every syndicate notable.
func syndicateIDs(g *Game) []string {
	var out []string
	for _, d := range g.Dens() {
		out = append(out, d.Fence)
	}
	for _, s := range g.SyndicateNotables() {
		out = append(out, s.ID)
	}
	return out
}

// meetSyndicate takes a made character to every den and every notable's
// home and talks to each there, returning whom it met.
func meetSyndicate(t *testing.T, g *Game, c *Char) []string {
	t.Helper()
	var met []string
	meet := func(id string) {
		i := slices.IndexFunc(g.PeopleHere(c, c.C.At), func(p Person) bool { return p.ID == id })
		if i < 0 {
			t.Fatalf("%s is not at %v for a made character", id, c.C.At)
		}
		talkTo(t, g, c, id)
		met = append(met, id)
	}
	for _, d := range g.Dens() {
		c.C.At = d.At
		meet(d.Fence)
	}
	for _, s := range g.SyndicateNotables() {
		c.C.At = s.Home
		if n := g.NPCs.Get(s.ID); n != nil {
			c.C.At = g.r.NPC.At(n, g.Tick())
		}
		meet(s.ID)
	}
	audit(t, g)
	return met
}

// npcMemory is what an NPC remembers and of whom, as JSON lines.
func npcMemory(t *testing.T, n *npc.NPC) []string {
	t.Helper()
	var out []string
	for _, v := range []any{n.Met, n.Summary} {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, string(b))
	}
	for _, e := range n.Memory {
		b, err := json.Marshal(e)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, string(b))
	}
	return out
}

// keeps reports whether after holds the meetings and summary of before
// unchanged and every memory entry before held.
func keeps(after, before []string) bool {
	if len(after) < len(before) || after[0] != before[0] || after[1] != before[1] {
		return false
	}
	for _, e := range before[2:] {
		if !slices.Contains(after[2:], e) {
			return false
		}
	}
	return true
}

package game

import (
	"errors"
	"slices"
	"strconv"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// thiefWorld is a new world's character at its starting settlement, whose
// trader's purse holds coin to lift.
func thiefWorld(t *testing.T, coin int64) (*Game, *Char, npc.Stub) {
	t.Helper()
	g := storyGame(t)
	c := mustCreate(t, g, "thief", "knife")
	tr, ok := g.traderStub(c.C.At)
	if !ok {
		t.Fatal("no trader at the start")
	}
	fund(t, g, ledger.NPCPool(tr.ID), ledger.Coin, coin)
	return g, c, tr
}

// fund books units of an asset to an account, out of the faction source.
func fund(t *testing.T, g *Game, acc, asset string, units int64) {
	t.Helper()
	if units == 0 {
		return
	}
	if err := g.post(ledger.Move("fund-"+acc+"-"+asset+"-"+strconv.FormatInt(g.Ledger.Posted, decimal), "test", g.Tick(), ledger.FromFaction, acc, asset, units)); err != nil {
		t.Fatal(err)
	}
}

// winPick is the first option on the character's beat that wins it
// without a machine, else the cautious one.
func winPick(g *Game, c *Char) string {
	_, opts := g.beat(c, g.Tick())
	for _, o := range opts {
		if o.Kind == fight.Win && !o.Puzzle {
			return o.ID
		}
	}
	for _, o := range opts {
		if o.Kind == fight.Careful {
			return o.ID
		}
	}
	return opts[0].ID
}

// ended is the fact of one of kinds among facts.
func ended(facts []fact.Fact, kinds ...string) (fact.Fact, bool) {
	i := slices.IndexFunc(facts, func(f fact.Fact) bool { return slices.Contains(kinds, f.Kind) })
	if i < 0 {
		return fact.Fact{}, false
	}
	return facts[i], true
}

func datum(f fact.Fact, key string) fact.Datum {
	d, _ := f.Get(key)
	return d
}

// pressTo presses a theft or flight in copies of g, each naming its
// encounter afresh, until one ends as want: "won" with no beat failed, or
// "lost", caught and then backed out of. witness ≥ 0 fixes the odds a
// theft is seen at; before runs once the encounter has begun. It returns
// the copy, its character and the fact the end wrote.
func pressTo(t *testing.T, g *Game, id string, cmd Command, witness int64, want string, before func(*Game, *Char)) (*Game, *Char, fact.Fact) {
	t.Helper()
	ends := []string{factTheft, factWatchFled, factWatchCaught}
	for n := range 60 {
		g2 := reload(t, g)
		c := g2.Char(id)
		if n > 0 {
			c.C.Align().Thefts += int64(n)
		}
		cmd.Key, cmd.Char = "go-"+strconv.Itoa(n), id
		if _, err := g2.Act(cmd); err != nil {
			t.Fatal(err)
		}
		if c.Fight == nil || c.Fight.Theft == nil {
			t.Fatal("the command began no theft")
		}
		if witness >= 0 {
			c.Fight.Theft.Witness = witness
		}
		if before != nil {
			before(g2, c)
		}
		for i := 0; c.Fight != nil; i++ {
			pick := winPick(g2, c)
			if c.Fight.Theft.Failed && want == theftLost {
				pick = wayOut
			}
			res, err := g2.Act(Command{Key: "press-" + strconv.Itoa(n) + "-" + strconv.Itoa(i), Char: id, Kind: Press, Option: pick})
			if err != nil {
				t.Fatal(err)
			}
			failed := len(res.Pressed) > 0 && !res.Pressed[0].Outcome.Success && res.Pressed[0].Option.Kind != fight.WayOut
			if f, ok := ended(res.Facts, ends...); ok {
				won := f.Kind == factWatchFled || (f.Kind == factTheft && datum(f, "outcome").S != theftLost)
				if won == (want != theftLost) {
					return g2, c, f
				}
				break
			}
			if failed && want != theftLost {
				break
			}
		}
	}
	t.Fatalf("no theft ended %s in 60 tries", want)
	return nil, nil, fact.Fact{}
}

func liftCmd(id string) Command { return Command{Kind: Steal, Option: KindLift, NPC: id} }

func factsOfKind(g *Game, kind string) []fact.Fact {
	var out []fact.Fact
	for _, f := range g.Log.Since(0) {
		if f.Kind == kind {
			out = append(out, f)
		}
	}
	return out
}

// A lift nobody sees takes the purse's coin, never marks coin hot, moves
// alignment privately, costs no standing and leaves the victim a memory
// of being robbed by no one.
func TestLiftWonUnwitnessed(t *testing.T) {
	g, c, tr := thiefWorld(t, 50)
	k, _ := g.TheftKind(KindLift)
	key := g.factionKeyOf(tr)
	g2, c2, f := pressTo(t, g, c.C.ID, liftCmd(tr.ID), 0, theftWon, nil)
	purse := ledger.NPCPool(tr.ID)
	switch {
	case datum(f, "outcome").S != theftWon || datum(f, "witnessed").N != 0 || datum(f, "coin").N != k.Coin:
		t.Fatalf("an unseen lift wrote %+v", f.Data)
	case g2.Ledger.Of(purse, ledger.Coin) != 50-k.Coin || c2.C.Coin != c.C.Coin+k.Coin:
		t.Fatalf("the purse holds %d and the thief %d", g2.Ledger.Of(purse, ledger.Coin), c2.C.Coin)
	case len(char.HotLotsOf(c2.C)) != 0 || len(char.WantedOf(c2.C)) != 0:
		t.Fatal("lifted coin was marked or wanted")
	case c2.C.Standing.Get(key) != c.C.Standing.Get(key):
		t.Fatal("an unseen lift cost standing")
	case AlignmentOf(c2) >= 0 || len(char.KnownOf(c2.C)) != 0:
		t.Fatalf("an unseen lift left alignment %d, known %v", AlignmentOf(c2), char.KnownOf(c2.C))
	}
	moved := factsOfKind(g2, factAlignment)
	if len(moved) != 1 || datum(moved[0], "public").N != 0 || moved[0].Causes[0] != f.ID {
		t.Fatalf("the lift moved alignment by %+v", moved)
	}
	n := g2.NPCs.Get(tr.ID)
	if n == nil {
		t.Fatal("the victim was not saved")
	}
	if i := slices.IndexFunc(n.Memory, func(e npc.Entry) bool { return e.Kind == entryRobbed }); i < 0 || n.Memory[i].Player != "" {
		t.Fatalf("the victim remembers %+v", n.Memory)
	}
	if c2.Encounters != c.Encounters {
		t.Fatal("a theft counted as an encounter")
	}
	audit(t, g2)
}

// A lift seen costs standing with the victim's faction, puts the thief on
// the watch's list for wanted-days and names it in the victim's memory.
func TestLiftWonWitnessed(t *testing.T) {
	g, c, tr := thiefWorld(t, 50)
	key := g.factionKeyOf(tr)
	g2, c2, f := pressTo(t, g, c.C.ID, liftCmd(tr.ID), fixed.Hundredths, theftWon, nil)
	worth := datum(f, "worth").N
	loss := max(g.theftCell("standing-least"), worth/g.theftCell("standing-coin"))
	ws := char.WantedOf(c2.C)
	switch {
	case datum(f, "witnessed").N != 1 || datum(f, "standing").N != -loss:
		t.Fatalf("a seen lift wrote %+v", f.Data)
	case c2.C.Standing.Get(key) != c.C.Standing.Get(key)-loss:
		t.Fatalf("standing %d, want %d less", c2.C.Standing.Get(key), loss)
	case len(ws) != 1 || ws[0].Coin != worth || ws[0].Worth != worth || ws[0].Fact != int64(f.ID) || ws[0].Source != ledger.NPCPool(tr.ID):
		t.Fatalf("the watch wants %+v", ws)
	case ws[0].Ends != g2.Tick()+g.hotCell("wanted-days")*sheets.TicksPerDay || !c2.C.Has(char.WantedCondition, g2.Tick()):
		t.Fatalf("the entry ends at %d", ws[0].Ends)
	case len(char.KnownOf(c2.C)) != 1:
		t.Fatal("a seen theft is not known")
	}
	n := g2.NPCs.Get(tr.ID)
	if _, ok := g2.r.NPC.About(n, c2.C.ID, entryRobbed, g2.Tick()); !ok {
		t.Fatalf("the victim does not remember the thief: %+v", n.Memory)
	}
	audit(t, g2)
}

// A lift takes an item the NPC lists: the listing comes down and the item
// is in the thief's pack, hot under the victim's name.
func TestLiftTakesAListedItem(t *testing.T) {
	g, c, tr := thiefWorld(t, 0)
	n, _ := g.SettlementAt(c.C.At)
	g.Market.Trader[n] = 1000
	knife := craftTool(t, g, c)
	if _, err := g.Act(Command{Key: "sell", Char: c.C.ID, Kind: SellItem, Item: knife.ID}); err != nil {
		t.Fatal(err)
	}
	purse := ledger.NPCPool(tr.ID)
	li := slices.IndexFunc(g.Market.Listings, func(l market.Listing) bool { return l.Seller == purse && l.Item.ID == knife.ID })
	if li < 0 {
		t.Fatal("the trader listed nothing")
	}
	listing := g.Market.Listings[li].ID
	// Sell what the trader paid back out of the purse, so the item is all it holds.
	if have := g.Ledger.Of(purse, ledger.Coin); have > 0 {
		if err := g.post(ledger.Move("empty", "test", g.Tick(), purse, ledger.ToFees, ledger.Coin, have)); err != nil {
			t.Fatal(err)
		}
	}
	k, _ := g.TheftKind(KindLift)
	setLevel(c, practiceSleight, g.ItemValue(knife)/max(k.CoinPerSleight, 1)+1)
	g2, c2, f := pressTo(t, g, c.C.ID, liftCmd(tr.ID), 0, theftWon, nil)
	in := c2.C.Item(knife.ID)
	switch {
	case in == nil || !in.Hot.HotOn(g2.Tick()/sheets.TicksPerDay) || in.Hot.Victim != refKey(npc.Ref(tr.ID)):
		t.Fatalf("the knife is %+v", in)
	case datum(f, "item").S != knife.ID || datum(f, "units").N != 1:
		t.Fatalf("the lift wrote %+v", f.Data)
	case slices.ContainsFunc(g2.Market.Listings, func(l market.Listing) bool { return l.ID == listing }):
		t.Fatal("the listing stayed up")
	case slices.ContainsFunc(g2.Market.Held, func(h Held) bool { return h.Item == knife.ID }):
		t.Fatal("the trader still holds the knife")
	}
	audit(t, g2)
}

// burgleWorld holds the start's region for faction 0 with goods of the
// tile's tier in its store.
func burgleWorld(t *testing.T) (*Game, *Char, string) {
	t.Helper()
	g, c, _ := thiefWorld(t, 0)
	g.World.Regions[g.World.RegionAt(c.C.At)].Holder = 0
	f := &g.World.Factions[0]
	f.Fallen, f.Stock = false, 40
	tier := g.tierAt(c.C.At)
	mat := ""
	for _, m := range g.r.Book.Materials {
		if m.Tier == tier {
			mat = m.ID
			break
		}
	}
	fund(t, g, ledger.StorePool(0), ledger.Material(mat), 30)
	return g, c, mat
}

// A burglary takes the store's units, two goods of the faction's stock
// each, marks them hot under the faction and counts at the settlement.
func TestBurgleWon(t *testing.T) {
	for _, seen := range []bool{false, true} {
		g, c, mat := burgleWorld(t)
		k, _ := g.TheftKind(KindBurgle)
		witness := int64(0)
		if seen {
			witness = fixed.Hundredths
		}
		g2, c2, f := pressTo(t, g, c.C.ID, Command{Kind: Steal, Option: KindBurgle}, witness, theftWon, nil)
		units := min(k.Goods, 40) / k.GoodsPerUnit
		n, _ := g2.SettlementAt(c2.C.At)
		ws := char.WantedOf(c2.C)
		switch {
		case datum(f, "units").N != units || datum(f, "material").S != mat:
			t.Fatalf("a burglary wrote %+v", f.Data)
		case g2.Ledger.Of(ledger.StorePool(0), ledger.Material(mat)) != 30-units:
			t.Fatalf("the store holds %d", g2.Ledger.Of(ledger.StorePool(0), ledger.Material(mat)))
		case g2.HotUnits(c2, mat, g2.Tick()/sheets.TicksPerDay) != units:
			t.Fatalf("%d of the units are hot, want %d", g2.HotUnits(c2, mat, g2.Tick()/sheets.TicksPerDay), units)
		case g2.World.Factions[0].Stock != 40-k.GoodsPerUnit*units:
			t.Fatalf("the faction's stock is %d", g2.World.Factions[0].Stock)
		case len(g2.placeStory(n).Burgled) != 1:
			t.Fatal("the burglary was not counted")
		case seen && (len(ws) != 1 || len(ws[0].Goods) != 1 || ws[0].Goods[0].Qty != units || ws[0].Faction != factionOwner(0)):
			t.Fatalf("a seen burglary is wanted as %+v", ws)
		case !seen && len(ws) != 0:
			t.Fatal("an unseen burglary is wanted")
		}
		audit(t, g2)
	}
}

// waylayWorld puts a caravan on the thief's tile.
func waylayWorld(t *testing.T) (*Game, *Char, *emerge.Caravan, string) {
	t.Helper()
	g, c, _ := thiefWorld(t, 0)
	n, _ := g.SettlementAt(c.C.At)
	mat := g.r.Book.Materials[0].ID
	cv := &emerge.Caravan{ID: "cv-test", From: n, To: n, Depart: g.Tick(), Arrive: g.Tick() + sheets.TicksPerDay, Material: mat, Units: 20}
	g.Emergence.Caravans = append(g.Emergence.Caravans, cv)
	if err := g.post(ledger.Move("caravan", "test", g.Tick(), ledger.FromCaravan, ledger.CaravanPool(cv.ID), ledger.Material(mat), 20)); err != nil {
		t.Fatal(err)
	}
	return g, c, cv, mat
}

// A waylay is always seen; its goods come out of the caravan's pool, hot.
func TestWaylayWon(t *testing.T) {
	g, c, cv, mat := waylayWorld(t)
	k, _ := g.TheftKind(KindWaylay)
	share := fixed.PercentFloor(20, k.Share)
	g2, c2, f := pressTo(t, g, c.C.ID, Command{Kind: Steal, Option: KindWaylay, Target: cv.ID}, -1, theftWon, nil)
	switch {
	case datum(f, "witnessed").N != 1 || datum(f, "units").N != share:
		t.Fatalf("a waylay wrote %+v", f.Data)
	case g2.Ledger.Of(ledger.CaravanPool(cv.ID), ledger.Material(mat)) != 20-share:
		t.Fatal("the caravan lost the wrong share")
	case g2.HotUnits(c2, mat, g2.Tick()/sheets.TicksPerDay) != share || len(char.WantedOf(c2.C)) != 1:
		t.Fatal("a waylay's goods are not hot, or it is not wanted")
	}
	audit(t, g2)
}

// A waylay for the prey side a character backs goes to the side as goods
// delivered: the faction sink takes it, and the thief holds nothing hot.
func TestWaylayForTheSide(t *testing.T) {
	g, c, cv, mat := waylayWorld(t)
	k, _ := g.TheftKind(KindWaylay)
	share := fixed.PercentFloor(20, k.Share)
	refused := func(cmd Command, code string) {
		t.Helper()
		cmd.Key, cmd.Char = "no-"+code, c.C.ID
		var ref *Refused
		if _, err := g.Act(cmd); !errors.As(err, &ref) || ref.Code != code {
			t.Fatalf("%+v: %v, want %s", cmd, err, code)
		}
	}
	refused(Command{Kind: Steal, Option: KindWaylay, Target: cv.ID, ForSide: true}, NotABacker)
	refused(Command{Kind: Steal, Option: KindLift, ForSide: true}, BadArgs)
	r := g.World.RegionAt(c.C.At)
	g.Story.Arcs = append(g.Story.Arcs, &Arc{ID: "arc-war", Template: "the-road-war", Regions: []int{r}, Stages: []StageRun{{}}})
	g.Story.Backers = append(g.Story.Backers, Backing{Char: c.C.ID, Arc: "arc-war", Stage: 0, Side: sidePrey, Goal: "q-prey"})
	sunk := g.Ledger.Of(ledger.ToFaction, ledger.Material(mat))
	g2, c2, f := pressTo(t, g, c.C.ID, Command{Kind: Steal, Option: KindWaylay, Target: cv.ID, ForSide: true}, -1, theftWon, nil)
	switch {
	case datum(f, "side").S != "q-prey" || datum(f, "units").N != share:
		t.Fatalf("a waylay for the side wrote %+v", f.Data)
	case g2.Ledger.Of(ledger.ToFaction, ledger.Material(mat)) != sunk+share:
		t.Fatal("the side's goods were not delivered")
	case g2.hotHeld(c2, mat) != 0 || len(char.HotLotsOf(c2.C)) != 0:
		t.Fatal("the thief holds the side's goods")
	}
	audit(t, g2)
}

// A theft caught takes nothing and is wanted, priced on the planned haul.
func TestTheftLost(t *testing.T) {
	g, c, tr := thiefWorld(t, 50)
	k, _ := g.TheftKind(KindLift)
	key := g.factionKeyOf(tr)
	g2, c2, f := pressTo(t, g, c.C.ID, liftCmd(tr.ID), 0, theftLost, nil)
	ws := char.WantedOf(c2.C)
	loss := max(g.theftCell("standing-least"), k.Coin/g.theftCell("standing-coin"))
	switch {
	case datum(f, "outcome").S != theftLost || datum(f, "coin").N != 0 || datum(f, "worth").N != k.Coin:
		t.Fatalf("a caught lift wrote %+v", f.Data)
	case g2.Ledger.Of(ledger.NPCPool(tr.ID), ledger.Coin) != 50 || c2.C.Coin != c.C.Coin:
		t.Fatal("a caught lift took coin")
	case len(ws) != 1 || ws[0].Worth != k.Coin || ws[0].Coin != 0:
		t.Fatalf("the watch wants %+v", ws)
	case c2.C.Standing.Get(key) != c.C.Standing.Get(key)-loss || AlignmentOf(c2) >= 0:
		t.Fatal("a caught lift cost no standing or alignment")
	}
	audit(t, g2)
}

// A theft won after its haul is gone is empty: nothing marked, no
// alignment, nobody wanting the thief.
func TestTheftEmpty(t *testing.T) {
	g, c, tr := thiefWorld(t, 50)
	purse := ledger.NPCPool(tr.ID)
	drained := func(g2 *Game, _ *Char) {
		if err := g2.post(ledger.Move("drain", "test", g2.Tick(), purse, ledger.ToFees, ledger.Coin, g2.Ledger.Of(purse, ledger.Coin))); err != nil {
			t.Fatal(err)
		}
	}
	g2, c2, f := pressTo(t, g, c.C.ID, liftCmd(tr.ID), fixed.Hundredths, theftWon, drained)
	switch {
	case datum(f, "outcome").S != theftEmpty || datum(f, "worth").N != 0:
		t.Fatalf("an empty lift wrote %+v", f.Data)
	case len(factsOfKind(g2, factAlignment)) != 0 || len(char.WantedOf(c2.C)) != 0 || AlignmentOf(c2) != 0:
		t.Fatal("an empty lift was punished")
	}
	audit(t, g2)
}

// A seen theft from a faction the thief stands well with betrays it.
func TestWitnessedTheftAtStandingBetrays(t *testing.T) {
	g, c, tr := thiefWorld(t, 50)
	key := g.factionKeyOf(tr)
	c.C.Standing.Bump(key, g.theftCell("betray-at")-c.C.Standing.Get(key))
	g2, c2, f := pressTo(t, g, c.C.ID, liftCmd(tr.ID), fixed.Hundredths, theftWon, nil)
	bs := factsOfKind(g2, factBetrayed)
	switch {
	case len(bs) != 1 || datum(bs[0], "faction").S != key || bs[0].Causes[0] != f.ID:
		t.Fatalf("betrayals %+v", bs)
	case c2.C.Standing.Get(key) > g.theftCell("betrayal-standing") || !c2.GrudgeWith(key, g2.Tick()/sheets.TicksPerDay):
		t.Fatal("the betrayal left standing or no grudge")
	}

	// Unseen, the faction never knows.
	g3, _, _ := pressTo(t, g, c.C.ID, liftCmd(tr.ID), 0, theftWon, nil)
	if len(factsOfKind(g3, factBetrayed)) != 0 {
		t.Fatal("an unseen theft betrayed")
	}
}

// A made thief robbing a fence betrays the syndicate, seen or not.
func TestMadeThiefRobbingAFenceBetrays(t *testing.T) {
	g, c, _ := thiefWorld(t, 0)
	d, ok := g.DenAt(c.C.At)
	if !ok {
		t.Fatal("no den at the start")
	}
	c.C.Align().Made = true
	c.C.Standing.Bump(syndicateKey, 30)
	fund(t, g, ledger.NPCPool(d.Fence), ledger.Coin, 40)
	g2, c2, _ := pressTo(t, g, c.C.ID, liftCmd(d.Fence), 0, theftWon, nil)
	bs := factsOfKind(g2, factBetrayed)
	switch {
	case len(bs) != 1 || datum(bs[0], "faction").S != syndicateKey:
		t.Fatalf("betrayals %+v", bs)
	case char.IsMade(c2.C) || len(factsOfKind(g2, factUnmade)) != 1:
		t.Fatal("the thief is still made")
	}
	audit(t, g2)
}

// A steal refused changes nothing: nothing named, nothing booked, already
// in a theft, held by the watch.
func TestRefusedStealChangesNothing(t *testing.T) {
	g, c, tr := thiefWorld(t, 0)
	for _, x := range []struct {
		cmd  Command
		code string
	}{
		{liftCmd("nobody"), NoTarget},
		{liftCmd(tr.ID), NothingToSteal},
		{Command{Kind: Steal, Option: KindWaylay, Target: "cv-none"}, NoTarget},
		{Command{Kind: Steal, Option: KindFlee}, BadArgs},
		{Command{Kind: Steal, Option: "pickpocket"}, BadArgs},
		{Command{Kind: Flee}, NotStopped},
		{Command{Kind: PayFine}, NotStopped},
	} {
		before, _ := g.Digest()
		x.cmd.Key, x.cmd.Char = "refused", c.C.ID
		var ref *Refused
		if _, err := g.Act(x.cmd); !errors.As(err, &ref) || ref.Code != x.code {
			t.Fatalf("%+v: %v, want %s", x.cmd, err, x.code)
		}
		if after, _ := g.Digest(); after != before || c.C.Alignment != nil {
			t.Fatalf("%+v changed the game", x.cmd)
		}
	}
	fund(t, g, ledger.NPCPool(tr.ID), ledger.Coin, 30)
	if _, err := g.Act(Command{Key: "go", Char: c.C.ID, Kind: Steal, Option: KindLift, NPC: tr.ID}); err != nil {
		t.Fatal(err)
	}
	before, _ := g.Digest()
	var ref *Refused
	if _, err := g.Act(Command{Key: "again", Char: c.C.ID, Kind: Steal, Option: KindLift, NPC: tr.ID}); !errors.As(err, &ref) || ref.Code != Busy {
		t.Fatalf("a second steal mid-theft: %v", err)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatal("a refused second steal changed the game")
	}
}

// A theft names its encounter by the theft count and runs its kind's
// beats in order: the encounter count and every creature draw keyed on it
// stay where they were.
func TestTheftMovesNoEncounterDraw(t *testing.T) {
	g, c, tr := thiefWorld(t, 50)
	next := "e-" + c.C.ID + "-" + strconv.FormatInt(c.Encounters+1, decimal)
	g2, c2, _ := pressTo(t, g, c.C.ID, liftCmd(tr.ID), 0, theftWon, nil)
	if c2.Encounters != c.Encounters || "e-"+c2.C.ID+"-"+strconv.FormatInt(c2.Encounters+1, decimal) != next {
		t.Fatal("a theft moved the encounter count")
	}
	for _, f := range g2.Log.Since(0) {
		if strings.HasPrefix(f.Kind, encounterFacts) {
			t.Fatalf("a theft wrote %s", f.Kind)
		}
	}
	burgle, _ := g.TheftKind(KindBurgle)
	g3, c3, _ := burgleWorld(t)
	if _, err := g3.Act(Command{Key: "b", Char: c3.C.ID, Kind: Steal, Option: KindBurgle}); err != nil {
		t.Fatal(err)
	}
	e := c3.Fight.E
	if !slices.Equal(e.Beats, burgle.BeatIDs()) || !strings.HasPrefix(e.ID, "t-"+c3.C.ID+"-") || e.Creature.Archetype != "" || len(e.Creature.Drops) != 0 {
		t.Fatalf("a burglary assembled %+v", e)
	}
	if fam, lock, ok := g3.r.Fight.Machine(e); !ok || !lock || fam == "" {
		t.Fatal("a burglary's lock has no machine")
	}
	if got := item.Total(e.Haul); got != 0 {
		t.Fatal("a theft's stand-in carries a haul")
	}
}

// A hold whose entries lapsed is not carried over to a new entry: the
// later theft needs a fresh stop at the gate.
func TestWantedDropsStaleHold(t *testing.T) {
	g, c, _ := stoppedThief(t)
	n, ok := g.StoppedNow(c)
	if !ok {
		t.Fatal("the thief was not held")
	}
	h := g.SettlementHex(n)
	a := c.C.Alignment
	for i := range a.Wanted {
		a.Wanted[i].Ends = g.Tick()
	}
	if c.C.At != h {
		t.Fatalf("the held thief is not at the gate")
	}
	th := &Theft{Kind: KindLift, Victim: "npc:elsewhere", Faction: standingKey(g.holderAt(h), h), Place: n, At: h}
	g.wantedFor(c, th, taking{worth: 1}, 0, g.Tick())
	if _, ok := g.StoppedNow(c); ok || char.StoppedAt(c.C) != 0 {
		t.Fatalf("a lapsed hold carried over to a new entry: stopped %d", char.StoppedAt(c.C))
	}
}

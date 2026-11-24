package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

func partsSum(ps []fight.Part) int64 {
	var n int64
	for _, p := range ps {
		n += p.Value
	}
	return n
}

func partOf(ps []fight.Part, label string) int64 {
	for _, p := range ps {
		if p.Label == label {
			return p.Value
		}
	}
	return 0
}

func setLevel(c *Char, skill string, level int64) {
	c.C.Practice = slices.DeleteFunc(c.C.Practice, func(s char.Skill) bool { return s.ID == skill })
	c.C.Practice = append(c.C.Practice, char.Skill{ID: skill, Level: level})
}

// The witness odds are the sum of their parts, held between witness-least
// and witness-most: the base, an upright NPC who is neither the victim nor
// warm to the character, less Sleight and cover. A waylay is always seen.
func TestWitnessParts(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "witnessed", "knife")
	h := c.C.At
	victim := refKey(npc.Ref("victim"))
	people := []Person{
		{Stub: npc.Stub{ID: "upright"}, Leaning: npc.LeaningUpright},
		{Stub: npc.Stub{ID: "friend"}, Leaning: npc.LeaningUpright, Mood: MoodWarm},
		{Stub: npc.Stub{ID: "victim"}, Leaning: npc.LeaningUpright},
		{Stub: npc.Stub{ID: "crook"}, Leaning: npc.LeaningCrooked},
	}
	setLevel(c, practiceSleight, 2)
	k, _ := g.TheftKind(KindLift)
	w, parts := g.witnessAmong(c, KindLift, h, victim, people)
	cover := min(g.r.Gen.Baseline(h).Cover+g.charScale(c, "cover", 0), fixed.Hundredths)
	switch {
	case partOf(parts, partBase) != k.Witness:
		t.Fatalf("a lift in a settlement starts at %d, not %d", partOf(parts, partBase), k.Witness)
	case partOf(parts, partUpright) != g.theftCell("witness-upright"):
		t.Fatalf("the uprights add %d: one counts", partOf(parts, partUpright))
	case partOf(parts, partSleight) != -2*g.theftCell("witness-sleight"):
		t.Fatalf("Sleight 2 takes %d", partOf(parts, partSleight))
	case partOf(parts, partCover) != -cover/g.theftCell("witness-cover"):
		t.Fatalf("cover %d takes %d", cover, partOf(parts, partCover))
	}
	least, most := g.theftCell("witness-least"), g.theftCell("witness-most")
	if sum := partsSum(parts); w != min(max(sum, least), most) {
		t.Fatalf("odds %d from parts summing to %d", w, sum)
	}

	setLevel(c, practiceSleight, 40)
	if w, parts := g.witnessAmong(c, KindLift, h, victim, people); w != least || partsSum(parts) >= least {
		t.Fatalf("a master of Sleight is seen at %d", w)
	}
	setLevel(c, practiceSleight, 0)
	crowd := slices.Repeat([]Person{{Stub: npc.Stub{ID: "upright"}, Leaning: npc.LeaningUpright}}, 20)
	if w, parts := g.witnessAmong(c, KindLift, h, victim, crowd); w != most || partsSum(parts) <= most {
		t.Fatalf("a crowd of the upright sees a lift at %d", w)
	}
	if w, parts := g.witnessAmong(c, KindWaylay, h, "", crowd); w != fixed.Hundredths || len(parts) != 1 {
		t.Fatalf("a waylay is seen at %d", w)
	}
	if w, _ := g.witnessAmong(c, KindLift, h, victim, g.PeopleHere(c, h)); w < least || w > most {
		t.Fatalf("the people here see a lift at %d", w)
	}
}

// A lift takes only what the ledger books to an NPC: its purse's coin up
// to the cap, then an item it lists that fits what is left. An NPC with
// nothing booked is no target.
func TestLiftTargets(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "lifter", "knife")
	tr, ok := g.traderStub(c.C.At)
	if !ok {
		t.Fatal("no trader")
	}
	lift := func() (StealTarget, bool) {
		i := slices.IndexFunc(g.StealTargets(c), func(st StealTarget) bool { return st.Kind == KindLift && st.NPC == tr.ID })
		if i < 0 {
			return StealTarget{}, false
		}
		return g.StealTargets(c)[i], true
	}
	if _, ok := lift(); ok {
		t.Fatal("an NPC with nothing booked is a target")
	}
	purse := ledger.NPCPool(tr.ID)
	k, _ := g.TheftKind(KindLift)
	if err := g.post(ledger.Move("purse", "test", g.Tick(), ledger.FromFaction, purse, ledger.Coin, k.Coin+5)); err != nil {
		t.Fatal(err)
	}
	st, ok := lift()
	if !ok || st.Plan.Coin != k.Coin || st.Worth != k.Coin || st.Source != purse || st.Victim != refKey(npc.Ref(tr.ID)) || st.Plan.Item != "" {
		t.Fatalf("a lift from a full purse plans %+v", st)
	}
	if err := g.post(ledger.Move("purse-out", "test", g.Tick(), purse, ledger.ToFees, ledger.Coin, k.Coin)); err != nil {
		t.Fatal(err)
	}

	n, _ := g.SettlementAt(c.C.At)
	g.Market.Trader[n] = 1000
	knife := c.C.In(char.Hand, 0)
	if knife == nil {
		t.Fatal("no knife")
	}
	c.C.Equipped = slices.DeleteFunc(c.C.Equipped, func(e char.Equipped) bool { return e.Item == knife.ID })
	if _, err := g.Act(Command{Key: "sell", Char: c.C.ID, Kind: SellItem, Item: knife.ID}); err != nil {
		t.Fatal(err)
	}
	li := slices.IndexFunc(g.Market.Listings, func(l market.Listing) bool { return l.Seller == purse && l.Item.ID == knife.ID })
	if li < 0 {
		t.Fatal("the trader listed nothing")
	}
	worth := g.ItemValue(g.Market.Listings[li].Item)
	setLevel(c, practiceSleight, worth/max(k.CoinPerSleight, 1)+1)
	st, _ = lift()
	if st.Plan.Item != knife.ID || st.Plan.Listing != g.Market.Listings[li].ID || st.Worth != st.Plan.Coin+worth {
		t.Fatalf("a lift with room for the listed knife plans %+v", st)
	}
}

// A burglary takes one material of the tile's tier from the store of the
// living faction holding the region, as much as the store, the faction's
// stock and the kind's goods allow.
func TestBurgleTargets(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "burglar", "knife")
	h := c.C.At
	burgle := func() (StealTarget, bool) {
		i := slices.IndexFunc(g.StealTargets(c), func(st StealTarget) bool { return st.Kind == KindBurgle })
		if i < 0 {
			return StealTarget{}, false
		}
		return g.StealTargets(c)[i], true
	}
	r := g.World.RegionAt(h)
	g.World.Regions[r].Holder = 0
	f := &g.World.Factions[0]
	f.Fallen, f.Stock = false, 9
	if _, ok := burgle(); ok {
		t.Fatal("an empty store is a target")
	}
	tier := g.tierAt(h)
	mat := ""
	for _, m := range g.r.Book.Materials {
		if m.Tier == tier {
			mat = m.ID
			break
		}
	}
	if err := g.post(ledger.Move("store", "test", g.Tick(), ledger.FromFaction, ledger.StorePool(0), ledger.Material(mat), 30)); err != nil {
		t.Fatal(err)
	}
	k, _ := g.TheftKind(KindBurgle)
	st, ok := burgle()
	want := min(k.Goods, f.Stock) / k.GoodsPerUnit
	switch {
	case !ok || len(st.Plan.Goods) != 1 || st.Plan.Goods[0].Material != mat || st.Plan.Goods[0].Qty != want:
		t.Fatalf("a burglary plans %+v, not %d %s", st.Plan, want, mat)
	case st.Source != ledger.StorePool(0) || st.Faction != factionOwner(0) || st.Worth != g.WorthAt(h, ledger.Material(mat), want):
		t.Fatalf("a burglary is of %+v", st)
	}
	f.Stock = k.GoodsPerUnit - 1
	if _, ok := burgle(); ok {
		t.Fatal("a store whose faction has no stock left is a target")
	}
	f.Stock, f.Fallen = 9, true
	if _, ok := burgle(); ok {
		t.Fatal("a fallen faction's store is a target")
	}
}

// Worth is at the last price of the nearest market's book, else at
// reference value.
func TestWorthAt(t *testing.T) {
	g := storyGame(t)
	h := g.SettlementHex(0)
	mat := g.r.Book.Materials[0].ID
	if got, want := g.WorthAt(h, ledger.Material(mat), 3), 3*g.r.Values.Material(mat); got != want {
		t.Fatalf("unpriced goods are worth %d, not %d", got, want)
	}
	n, ok := g.MarketAt(h)
	if !ok {
		t.Fatal("no market at the first settlement")
	}
	b := g.Book(n, mat)
	b.Last, b.LastTick = 7, g.Tick()
	if got := g.WorthAt(h, ledger.Material(mat), 3); got != 21 {
		t.Fatalf("goods last sold at 7 are worth %d for 3", got)
	}
}

// A waylay takes the kind's share of each good a caravan on the tile
// holds, always seen; a backer of a running road war's prey side whose
// regions hold the tile may feed the side with it.
func TestWaylayTargets(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "raider", "knife")
	if g.Emergence == nil {
		t.Fatal("a new world has no emergence")
	}
	n, _ := g.SettlementAt(c.C.At)
	mat := g.r.Book.Materials[0].ID
	cv := &emerge.Caravan{ID: "cv-test", From: n, To: n, Depart: g.Tick(), Arrive: g.Tick() + sheets.TicksPerDay, Material: mat, Units: 20}
	g.Emergence.Caravans = append(g.Emergence.Caravans, cv)
	if err := g.post(ledger.Move("caravan", "test", g.Tick(), ledger.FromFaction, ledger.CaravanPool(cv.ID), ledger.Material(mat), 20)); err != nil {
		t.Fatal(err)
	}
	waylay := func() (StealTarget, bool) {
		i := slices.IndexFunc(g.StealTargets(c), func(st StealTarget) bool { return st.Kind == KindWaylay })
		if i < 0 {
			return StealTarget{}, false
		}
		return g.StealTargets(c)[i], true
	}
	k, _ := g.TheftKind(KindWaylay)
	share := fixed.PercentFloor(20, k.Share)
	st, ok := waylay()
	switch {
	case !ok || st.Caravan != cv.ID || len(st.Plan.Goods) != 1 || st.Plan.Goods[0].Qty != share || st.Source != ledger.CaravanPool(cv.ID):
		t.Fatalf("a waylay plans %+v, not %d of %s", st, share, mat)
	case st.Witness != fixed.Hundredths || st.Side != "":
		t.Fatalf("a waylay is seen at %d for side %q", st.Witness, st.Side)
	}
	r := g.World.RegionAt(c.C.At)
	g.Story.Arcs = append(g.Story.Arcs, &Arc{ID: "arc-war", Template: "the-road-war", Regions: []int{r}, Stages: []StageRun{{}}})
	g.Story.Backers = append(g.Story.Backers, Backing{Char: c.C.ID, Arc: "arc-war", Stage: 0, Side: sidePrey, Goal: "q-prey"})
	if st, _ := waylay(); st.Side != "q-prey" {
		t.Fatalf("a prey backer's waylay feeds %q", st.Side)
	}
	audit(t, g)
}

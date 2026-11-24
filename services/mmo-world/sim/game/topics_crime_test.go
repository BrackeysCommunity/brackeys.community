package game

import (
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// topicCrimeIDs are the topics theft and alignment add, by their predicate.
var topicCrimeIDs = []string{whenFenceApproach, whenWatchWarning, whenCrookedApproval, whenTurnedAway, whenKnowsGoods, whenGoodName, whenInvitation, whenInformer}

// raised is the topic of an id a conversation would offer, if any.
func topicOffered(g *Game, c *Char, n *npc.NPC, id string) (TopicView, bool) {
	cands := g.Candidates(c, n)
	if i := slices.IndexFunc(cands, func(v TopicView) bool { return v.ID == id }); i >= 0 {
		return cands[i], true
	}
	return TopicView{}, false
}

// onlyRaised fails unless, among the crime topics, an NPC raises exactly
// want with a character, voiced from fields.
func topicOnly(t *testing.T, g *Game, c *Char, n *npc.NPC, want ...string) {
	t.Helper()
	for _, id := range topicCrimeIDs {
		v, ok := topicOffered(g, c, n, id)
		if ok != slices.Contains(want, id) {
			t.Fatalf("%s raises %s: %v, want %v", n.Stub.Role, id, ok, !ok)
		}
		if ok && (strings.Contains(v.Line, "{") || !strings.Contains(v.Line, n.Stub.Name)) {
			t.Fatalf("%s's %s is not voiced from fields: %q", n.Stub.Role, id, v.Line)
		}
	}
}

// meetAgain has a character talk to an NPC on its tile again.
func topicMeet(t *testing.T, g *Game, c *Char, id string) *npc.NPC {
	t.Helper()
	if _, err := g.Act(Command{Key: "talk-" + c.C.ID + "-" + id + "-" + i64(int64(g.Log.Len())), Char: c.C.ID, Kind: Talk, NPC: id}); err != nil {
		t.Fatal(err)
	}
	return g.NPCs.Get(id)
}

// thread opens a personal thread of a template for a character, casting
// an NPC as its npc and binding the rest.
func topicThread(g *Game, c *Char, template, id string, more ...arc.Binding) *Arc {
	cast := append(arc.Cast{{Role: topicCastNPC, Ref: npc.Ref(id)}, {Role: "character", Ref: char.Ref(c.C.ID)}}, more...)
	a := &Arc{ID: arcPrefix + i64(int64(len(g.Story.Arcs)+1)), Template: template, Scope: arc.Personal, Char: c.C.ID, Cast: arc.Sorted(cast), Began: g.Tick()}
	g.Story.Arcs = append(g.Story.Arcs, a)
	return a
}

func topicHot(t *testing.T, g *Game, c *Char, id string, units int64) string {
	t.Helper()
	m := g.r.Book.Materials[0].ID
	grantFor(t, g, c, ledger.Material(m), units)
	g.markHot(c, []item.Spoil{{Material: m, Qty: units}}, g.hotMark(refKey(npc.Ref(id)), "", c.C.At, g.Tick()))
	return m
}

// Each crime topic fires only under its rule.
func TestCrimeTopicsFireOnlyUnderTheirRule(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "asked", "knife")
	people := meetResidents(t, g, c)
	watch, keeper := people[topicWatchRole], people["settlement-keeper"]
	if watch == nil || keeper == nil {
		t.Fatal("no watch captain or keeper where characters start")
	}
	for _, n := range people {
		topicOnly(t, g, c, n)
	}

	// The watch warns only of a Wanted entry that applies here.
	n, _ := g.SettlementAt(c.C.At)
	a := c.C.Align()
	a.Wanted = []char.Wanted{{Victim: "npc:someone", Place: n, Worth: 10, Ends: g.Tick() + sheets.TicksPerDay}}
	topicOnly(t, g, c, watch, whenWatchWarning)
	topicOnly(t, g, c, keeper)
	if v, _ := topicOffered(g, c, watch, whenWatchWarning); !strings.Contains(v.Line, g.r.NPC.Role(watch.Stub.Role).Role) {
		t.Fatalf("the warning does not name the captain's role: %q", v.Line)
	}
	a.Wanted[0].Ends = g.Tick()
	topicOnly(t, g, c, watch)
	a.Wanted = nil

	// Goods taken from the keeper are known to the keeper alone.
	m := topicHot(t, g, c, keeper.Stub.ID, 2)
	topicOnly(t, g, c, keeper, whenKnowsGoods)
	topicOnly(t, g, c, watch)
	if v, _ := topicOffered(g, c, keeper, whenKnowsGoods); !strings.Contains(v.Line, g.MaterialName(m)) || !v.Own {
		t.Fatalf("the keeper does not name its goods: %+v", v)
	}
	a.Hot = nil

	// A fence approaches only a character who can find it.
	d, ok := g.DenAt(c.C.At)
	if !ok {
		t.Fatal("no den where characters start")
	}
	a.Value = -15
	fence := topicMeet(t, g, c, d.Fence)
	topicOnly(t, g, c, fence, whenFenceApproach)
	a.Value = 0
	topicOnly(t, g, c, fence)

	// Warmth: a crooked NPC approves, an upright one speaks of a good name.
	a.Value = -60
	if g.Mood(c, fence.Stub.ID) != MoodWarm {
		t.Fatal("a fence is not warm to the Notorious")
	}
	topicOnly(t, g, c, fence, whenFenceApproach, whenCrookedApproval)
	a.Value = 60
	if g.Mood(c, watch.Stub.ID) != MoodWarm {
		t.Fatal("a watch captain is not warm to the Upright")
	}
	topicOnly(t, g, c, watch, whenGoodName)
	a.Value = 0

	// Cold turns away, and raises the cold shoulder first.
	g.r.NPC.Remember(keeper, npc.Entry{Kind: entryRobbed, Player: c.C.ID, Weight: 10, Tick: g.Tick()}, g.Tick())
	if g.Mood(c, keeper.Stub.ID) != MoodCold {
		t.Fatalf("a robbed keeper is %q", g.Mood(c, keeper.Stub.ID))
	}
	topicHot(t, g, c, keeper.Stub.ID, 1)
	topicOnly(t, g, c, keeper, whenTurnedAway, whenKnowsGoods)
	knows := slices.IndexFunc(g.r.NPC.Topics(), func(r sheets.Topic) bool { return r.When == whenKnowsGoods })
	g.r.NPC.Topics()[knows].Weight = 300
	defer func() { g.r.NPC.Topics()[knows].Weight = 140 }()
	if cands := g.Candidates(c, keeper); cands[0].ID != whenTurnedAway {
		t.Fatalf("a cold keeper raises %s first", cands[0].ID)
	}
	keeper.Memory = slices.DeleteFunc(keeper.Memory, func(e npc.Entry) bool { return e.Kind == entryRobbed })
	if cands := g.Candidates(c, keeper); cands[0].ID != whenKnowsGoods {
		t.Fatalf("salience no longer orders a keeper that is not cold: %s first", cands[0].ID)
	}
	a.Hot = nil

	// The thread topics: only the NPC the character's open thread casts.
	inv := topicThread(g, c, whenInvitation, fence.Stub.ID)
	other := mustCreate(t, g, "other", "knife")
	a.Value = -15
	other.C.Align().Value = -15
	topicOnly(t, g, c, fence, whenFenceApproach, whenInvitation)
	topicOnly(t, g, other, fence, whenFenceApproach)
	topicOnly(t, g, c, keeper)
	inv.Outcome = outcomeLapsed
	topicOnly(t, g, c, fence, whenFenceApproach)
	a.Value, other.C.Align().Value = 0, 0

	inf := topicThread(g, c, whenInformer, watch.Stub.ID, arc.Binding{Role: topicCastDen, Ref: arc.SettlementRef(d.Place)})
	topicOnly(t, g, c, watch, whenInformer)
	if v, _ := topicOffered(g, c, watch, whenInformer); !strings.Contains(v.Line, g.placeName(g.SettlementHex(d.Place))) {
		t.Fatalf("the captain does not name the den's settlement: %q", v.Line)
	}
	inf.Outcome = outcomeLapsed
	topicOnly(t, g, c, watch)
}

// A hostile NPC offers only the cold shoulder and refuses every other
// choice and every trade, changing nothing; a hostile notable queues the
// debt.
func TestHostileOffersOnlyTurnedAway(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "hated", "knife")
	people := meetResidents(t, g, c)
	watch := people[topicWatchRole]
	n, _ := g.SettlementAt(c.C.At)
	a := c.C.Align()
	a.Value = -60
	a.Wanted = []char.Wanted{{Victim: "npc:someone", Place: n, Worth: 10, Ends: g.Tick() + sheets.TicksPerDay}}
	topicOnly(t, g, c, watch, whenTurnedAway, whenWatchWarning)
	g.r.NPC.Remember(watch, npc.Entry{Kind: entryRobbed, Player: c.C.ID, Weight: 10, Tick: g.Tick()}, g.Tick())
	if g.Mood(c, watch.Stub.ID) != MoodHostile {
		t.Fatalf("a robbed upright captain is %q to the Notorious", g.Mood(c, watch.Stub.ID))
	}
	conv, err := g.Converse(c, watch.Stub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(conv.Topics) != 1 || conv.Topics[0].ID != whenTurnedAway {
		t.Fatalf("a hostile captain offers %+v", conv.Topics)
	}
	hotRefused(t, g, HostileCode, "a choice past the cold shoulder", func() error {
		_, err := g.Act(Command{Key: "warned", Char: c.C.ID, Kind: Choose, NPC: watch.Stub.ID, Option: whenWatchWarning + "/pay-fine"})
		return err
	})
	if _, err := g.Act(Command{Key: "pleaded", Char: c.C.ID, Kind: Choose, NPC: watch.Stub.ID, Option: whenTurnedAway + "/plead"}); err != nil {
		t.Fatalf("the cold shoulder itself was refused: %v", err)
	}
	if slices.ContainsFunc(g.Story.Pending, func(p arc.Pending) bool { return p.Kind == arc.PendDebt && p.Ref == npc.Ref(watch.Stub.ID) }) {
		t.Fatal("a hostile captain who is no notable queued the debt")
	}

	// The syndicate's notables are notables: a hostile one queues the debt.
	a.Made = true
	a.Grudges = []char.Grudge{{Faction: syndicateKey, Ends: g.Tick()/sheets.TicksPerDay + 1}}
	leader := topicMeet(t, g, c, synLeaderID)
	if !slices.ContainsFunc(g.Story.Pending, func(p arc.Pending) bool {
		return p.Kind == arc.PendDebt && p.Char == c.C.ID && p.Ref == npc.Ref(leader.Stub.ID)
	}) {
		t.Fatal("a hostile syndicate notable queued no debt")
	}

	// Trade: a hostile trader neither buys nor sells.
	tr, ok := g.traderStub(c.C.At)
	if !ok {
		t.Skip("no trader here")
	}
	a.Value, a.Made, a.Grudges, a.Wanted = 0, false, nil, nil
	in := craftTool(t, g, c)
	if _, err := g.Act(Command{Key: "sold", Char: c.C.ID, Kind: SellItem, Item: in.ID}); err != nil {
		t.Fatal(err)
	}
	c.C.People = []char.Disposition{{Notable: tr.ID, Value: g.r.NPC.Param("disposition-hostile")}}
	other := craftTool(t, g, c)
	hotRefused(t, g, HostileCode, "selling to a hostile trader", func() error {
		_, err := g.Act(Command{Key: "sold-again", Char: c.C.ID, Kind: SellItem, Item: other.ID})
		return err
	})
	mk, _ := g.MarketAt(c.C.At)
	i := slices.IndexFunc(g.ListingsAt(mk), func(l market.Listing) bool { return l.Seller == ledger.NPCPool(tr.ID) })
	if i < 0 {
		t.Fatal("the trader did not list what it bought")
	}
	grantFor(t, g, c, ledger.Coin, g.ListingsAt(mk)[i].Price)
	hotRefused(t, g, HostileCode, "buying from a hostile trader", func() error {
		_, err := g.Act(Command{Key: "bought", Char: c.C.ID, Kind: Purchase, Item: g.ListingsAt(mk)[i].ID})
		return err
	})
	audit(t, g)
}

// Warmth pays disposition-price per cent more for an item, and as much
// again with the trader's discount; cold pays that much less.
func TestWarmPricesAreBetter(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "liked", "knife")
	tr, ok := g.traderStub(c.C.At)
	if !ok {
		t.Skip("no trader here")
	}
	in := craftTool(t, g, c)
	base := g.TraderPays(in)
	p := g.r.NPC.Param("disposition-price")
	held := func(v int64) { c.C.People = []char.Disposition{{Notable: tr.ID, Value: v}} }
	for _, x := range []struct {
		what     string
		value    int64
		discount bool
		pct      int64
	}{
		{"neutral", 0, false, fixed.Hundredths},
		{"neutral with a discount", 0, true, fixed.Hundredths},
		{"warm", g.r.NPC.Param("disposition-warm"), false, fixed.Hundredths + p},
		{"warm with a discount", g.r.NPC.Param("disposition-warm"), true, fixed.Hundredths + 2*p},
		{"cold", g.r.NPC.Param("disposition-cold"), false, fixed.Hundredths - p},
		{"cold with a discount", g.r.NPC.Param("disposition-cold"), true, fixed.Hundredths - p},
	} {
		held(x.value)
		c.C.Flags = slices.DeleteFunc(c.C.Flags, func(f string) bool { return f == flagDiscount+tr.ID })
		if x.discount {
			c.C.Flags = append(c.C.Flags, flagDiscount+tr.ID)
		}
		if got, want := g.TraderPaysHere(c, in), fixed.PercentOf(base, x.pct); got != want {
			t.Fatalf("%s: the trader pays %d, want %d", x.what, got, want)
		}
	}
	held(g.r.NPC.Param("disposition-warm"))
	c.C.Flags = nil
	want := fixed.PercentOf(base, fixed.Hundredths+p)
	if want <= base {
		t.Fatalf("a warm price of %d is no better than %d", want, base)
	}
	coin := g.balance(c, ledger.Coin)
	if _, err := g.Act(Command{Key: "warm-sale", Char: c.C.ID, Kind: SellItem, Item: in.ID}); err != nil {
		t.Fatal(err)
	}
	if got := g.balance(c, ledger.Coin) - coin; got != want {
		t.Fatalf("a warm trader paid %d, want %d", got, want)
	}
	audit(t, g)
}

// A grudge holds every NPC of the betrayed faction at the grudge's −40,
// over a crooked NPC's +20 for the Notorious: a fence turns the betrayer
// away.
func TestGrudgeOverridesCrookedWarmth(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "betrayer", "knife")
	d, ok := g.DenAt(c.C.At)
	if !ok {
		t.Fatal("no den where characters start")
	}
	a := c.C.Align()
	a.Value = -60
	fence := topicMeet(t, g, c, d.Fence)
	warm := g.Disposition(c, fence.Stub.ID)
	if warm < g.r.NPC.Param("disposition-warm") {
		t.Fatalf("a fence holds the Notorious at %d", warm)
	}
	topicOnly(t, g, c, fence, whenFenceApproach, whenCrookedApproval)
	a.Grudges = []char.Grudge{{Faction: syndicateKey, Ends: g.Tick()/sheets.TicksPerDay + 1}}
	if got := g.Disposition(c, fence.Stub.ID); got != g.r.NPC.Param("grudge-disposition") {
		t.Fatalf("a betrayed fence holds the character at %d", got)
	}
	topicOnly(t, g, c, fence, whenTurnedAway)
}

// The fine pays off the watch, and giving the goods back returns them to
// the NPC robbed.
func TestFineAndReturnEffects(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "sorry", "knife")
	people := meetResidents(t, g, c)
	watch, keeper := people[topicWatchRole], people["settlement-keeper"]
	n, _, _, _, _ := robbedOf(t, g, c)
	grantFor(t, g, c, ledger.Coin, 200)
	if _, err := g.Act(Command{Key: "pay", Char: c.C.ID, Kind: Choose, NPC: watch.Stub.ID, Option: whenWatchWarning + "/pay-fine"}); err != nil {
		t.Fatal(err)
	}
	if len(g.wantedAt(c, n, g.Tick())) != 0 || len(factsOf(g, factWatchPaid)) != 1 {
		t.Fatal("choosing to pay left the watch wanting")
	}
	audit(t, g)

	m := topicHot(t, g, c, keeper.Stub.ID, 3)
	purse := ledger.NPCPool(keeper.Stub.ID)
	before := g.Ledger.Of(purse, ledger.Material(m))
	if _, err := g.Act(Command{Key: "back", Char: c.C.ID, Kind: Choose, NPC: keeper.Stub.ID, Option: whenKnowsGoods + "/give-them-back"}); err != nil {
		t.Fatal(err)
	}
	if got := g.Ledger.Of(purse, ledger.Material(m)) - before; got != 3 {
		t.Fatalf("the keeper got back %d units, want 3", got)
	}
	if _, ok := topicOffered(g, c, keeper, whenKnowsGoods); ok {
		t.Fatal("the keeper still knows goods given back")
	}
	chose := factsOf(g, "npc.chose")
	last := chose[len(chose)-1]
	if choice, _ := last.Get("choice"); !slices.Contains(last.Subjects, npc.Ref(keeper.Stub.ID)) || choice.S != "give-them-back" {
		t.Fatalf("the choice is not recorded: %+v", last)
	}
	audit(t, g)
}

// A robbed memory fades at robbed-decay of the rate its kind would.
func TestRobbedFadesSlower(t *testing.T) {
	g := guardGame(t)
	r := g.r.NPC
	const days = 10
	now := int64(days * sheets.TicksPerDay)
	rate := days * r.Param("salience-decay")
	personal := fixed.PercentOf(rate, r.Param("personal-decay-share"))
	for _, x := range []struct {
		e    npc.Entry
		want int64
	}{
		{npc.Entry{Kind: entryWronged, Player: "c-1", Weight: 60}, 60 - personal},
		{npc.Entry{Kind: entryRobbed, Player: "c-1", Weight: 60}, 60 - fixed.PercentOf(personal, r.Param("robbed-decay"))},
		{npc.Entry{Kind: entryRobbed, Weight: 60}, 60 - fixed.PercentOf(rate, r.Param("robbed-decay"))},
	} {
		if got := r.Salience(x.e, now); got != x.want {
			t.Fatalf("%+v: salience %d, want %d", x.e, got, x.want)
		}
	}
}

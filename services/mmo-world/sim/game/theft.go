package game

import (
	"fmt"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/tally"
)

// Theft (GDD 6.5): an encounter of fixed beats against a stand-in, so no
// creature draw and no encounter count moves. Its haul is only ever what
// the ledger books to an NPC, a faction's store or a caravan, taken as it
// stands when the last beat is won.

func init() {
	crimeCommands[Steal] = (*Game).steal
	crimeCommands[PayFine] = (*Game).payFine
	crimeCommands[Flee] = (*Game).flee
}

// structural: theft.made's outcomes, the transaction kind a haul posts
// as, and the ref kind of a fight's stand-in.
const (
	theftLost      = "lost"
	theftEmpty     = "empty"
	txnTheft       = "theft"
	refArchetype   = "archetype"
	encounterFacts = "encounter."
)

// steal begins a theft of a kind on the character's tile: a target from
// StealTargets, its haul and witness odds fixed now.
func (g *Game) steal(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	if c.Delving != nil {
		return refuse(Busy, "%s is inside a dungeon", c.C.ID)
	}
	if _, ok := g.StoppedNow(c); ok {
		return refuse(StoppedCode, "the watch holds %s", c.C.ID)
	}
	k, ok := g.TheftKind(cmd.Option)
	if !ok || k.Watch {
		return refuse(BadArgs, "no theft %q", cmd.Option)
	}
	if cmd.ForSide && k.ID != KindWaylay {
		return refuse(BadArgs, "only a waylay feeds a side")
	}
	st, err := g.stealTarget(c, k.ID, cmd)
	if err != nil {
		return err
	}
	if cmd.ForSide && st.Side == "" {
		return refuse(NotABacker, "%s backs no prey side here", c.C.ID)
	}
	h := c.C.At
	place := -1
	if n, ok := g.SettlementAt(h); ok {
		place = n
	}
	th := &Theft{Kind: k.ID, Victim: st.Victim, NPC: st.NPC, Caravan: st.Caravan, Faction: st.Faction, Source: st.Source,
		Witness: st.Witness, Parts: st.Parts, Coin: st.Plan.Coin, Goods: st.Plan.Goods, Item: st.Plan.Item,
		Listing: st.Plan.Listing, Worth: st.Plan.Worth, Place: place, At: h}
	if cmd.ForSide {
		th.Side = st.Side
	}
	g.beginTheft(c, k, h, th)
	return nil
}

// stealTarget is the target a steal names, or why there is none: nothing
// to name here, or someone here with nothing booked to it.
func (g *Game) stealTarget(c *Char, kind string, cmd Command) (StealTarget, error) {
	for _, st := range g.StealTargets(c) {
		if st.Kind != kind {
			continue
		}
		switch {
		case kind == KindLift && st.NPC == cmd.NPC, kind == KindWaylay && st.Caravan == cmd.Target, kind == KindBurgle:
			return st, nil
		}
	}
	h := c.C.At
	here := false
	switch kind {
	case KindLift:
		here = cmd.NPC != "" && slices.ContainsFunc(g.PeopleHere(c, h), func(p Person) bool { return p.ID == cmd.NPC })
	case KindWaylay:
		cv := g.castCaravan(cmd.Target)
		here = cv != nil && g.caravanAt(cv, g.Tick()) == h
	case KindBurgle:
		if n, ok := g.SettlementAt(h); ok && g.Places[n].Ruined == 0 {
			fi := g.holderAt(h)
			here = fi >= 0 && fi < len(g.World.Factions) && !g.World.Factions[fi].Fallen
		}
	}
	if here {
		return StealTarget{}, refuse(NothingToSteal, "nothing is booked there to take")
	}
	return StealTarget{}, refuse(NoTarget, "no %s to make here", kind)
}

// beginTheft opens a theft or flight encounter of a kind's fixed beats
// against a stand-in at the tile's tier, named by the character's count of
// them so no encounter or creature draw moves.
func (g *Game) beginTheft(c *Char, k sheets.TheftKind, h hex.Hex, th *Theft) {
	id := nextTheftID(c)
	c.C.Align().Thefts++
	cr := fight.Creature{Tier: g.tierAt(h), Tags: tags.Of(k.Tags), Drops: []string{}}
	site := fight.Site{ID: id, Place: machinePlace(h, 0), Tags: g.World.Place(h).Tags(), Measures: g.measures(h), Party: 1, Fixed: k.BeatIDs()}
	e := g.r.Fight.Assemble(site, cr)
	c.Fight = &Fight{E: e, Measures: site.Measures, Theft: th}
}

// theftPress presses an option on a theft's or a flight's beat. A won
// beat of a theft practises Sleight; the first failed beat is the theft
// caught, and ends a flight there and then.
func (g *Game) theftPress(c *Char, key, pick string, tick int64, w *worked) ([]fight.Pressed, error) {
	e, th := c.Fight.E, c.Fight.Theft
	kit, opts := g.beat(c, tick)
	o, ok := fight.OptionByID(opts, pick)
	if !ok {
		return nil, refuse(BadArgs, "no option %q on this beat", pick)
	}
	m := &fight.Member{Ch: c.C, Kit: kit, Pick: pick}
	if o.Puzzle {
		if w == nil {
			return nil, refuse(InActivity, "a machine is worked in the Activity")
		}
		m.Puzzle = &w.res
	}
	pack := slices.Clone(c.C.Pack)
	pressed, facts, err := g.r.Fight.Press(e, []*fight.Member{m}, tick)
	if err != nil {
		return nil, err
	}
	if err := g.logEncounterFacts(c.C.At, e, theftFacts(facts), w); err != nil {
		return nil, err
	}
	// The stand-in is nobody's nemesis.
	c.C.Fights.DownedBy = slices.DeleteFunc(c.C.Fights.DownedBy, func(x tally.Count) bool { return x.Key == "" })
	if err := g.lost(c, key, pack, tick); err != nil {
		return nil, err
	}
	if len(pressed) > 0 {
		p := pressed[0]
		switch {
		case p.Outcome.Success && p.Option.Kind == fight.Win && th.Kind != KindFlee:
			if err := g.practise(c, practiceSleight, 1, tick); err != nil {
				return nil, err
			}
		case !p.Outcome.Success && p.Option.Kind != fight.WayOut:
			th.Failed = true
			if th.Kind == KindFlee && !e.Over {
				e.Over, e.Result = true, fight.Lost
			}
		}
	}
	if e.Over {
		return pressed, g.theftEnded(c, key, tick)
	}
	return pressed, nil
}

// theftFacts are an engine step's facts as a theft keeps them: no
// encounter end, which goals would read as a creature defeated, and no
// stand-in named.
func theftFacts(facts []fact.Fact) []fact.Fact {
	var out []fact.Fact
	for _, f := range facts {
		if strings.HasPrefix(f.Kind, encounterFacts) {
			continue
		}
		f.Subjects = slices.DeleteFunc(slices.Clone(f.Subjects), func(r fact.Ref) bool { return r.Kind == refArchetype && r.ID == "" })
		out = append(out, f)
	}
	return out
}

// theftEnded closes a theft or a flight. A theft caught is lost; one won
// takes what is there; one backed out of, or held, with no beat failed,
// was no theft.
func (g *Game) theftEnded(c *Char, key string, t int64) error {
	e, th := c.Fight.E, c.Fight.Theft
	c.Fight = nil
	c.Swapped = 0
	acc := ledger.Char(c.C.ID)
	for j, sv := range e.Salvage {
		for i, s := range sv.Spoil {
			if err := g.receive(c, ledger.Move(ledger.SubKey(key, "salvage", i64(int64(j)), i64(int64(i))), "salvage", t, ledger.FromSalvage, acc, ledger.Material(s.Material), s.Qty)); err != nil {
				return err
			}
		}
	}
	if th.Kind == KindFlee {
		return g.fleeEnded(c, e, th, key, t)
	}
	switch {
	case th.Failed:
		return g.theftResolved(c, th, theftLost, taking{worth: th.Worth}, true, t, key)
	case e.Result == fight.Won:
		tk := g.takeable(c, th)
		if tk.empty() {
			return g.theftResolved(c, th, theftEmpty, tk, false, t, key)
		}
		k, _ := g.TheftKind(th.Kind)
		seen := k.Always || g.r.draw.Percent(th.Witness, "theft.witness", draw.Str(c.C.ID), draw.Str(e.ID))
		return g.theftResolved(c, th, theftWon, tk, seen, t, key)
	}
	return nil
}

// taking is what a won theft takes as things stand, and its legs.
type taking struct {
	coin  int64
	goods []item.Spoil
	in    *item.Instance
	legs  []ledger.Leg
	worth int64
}

func (tk taking) empty() bool { return tk.coin == 0 && len(tk.goods) == 0 && tk.in == nil }

// units is how many goods and items a taking holds.
func (tk taking) units() int64 {
	n := item.Total(tk.goods)
	if tk.in != nil {
		n++
	}
	return n
}

// takeable is the planned haul held to what its source holds now: coin
// and an item still listed from an NPC's purse, a store's units within
// its faction's stock, a live caravan's goods. A haul for a side goes to
// the faction sink, delivered, and never to the thief.
func (g *Game) takeable(c *Char, th *Theft) taking {
	acc := ledger.Char(c.C.ID)
	dest := acc
	if th.Side != "" {
		dest = ledger.ToFaction
	}
	var tk taking
	switch th.Kind {
	case KindLift:
		if tk.coin = min(th.Coin, g.Ledger.Of(th.Source, ledger.Coin)); tk.coin > 0 {
			tk.legs = ledger.Pair(th.Source, acc, ledger.Coin, tk.coin)
		}
		if l, ok := g.listingOf(th.Listing); ok && l.Seller == th.Source && l.Item.ID == th.Item &&
			g.Ledger.Of(ledger.EscrowPool(l.ID), ledger.Item(l.Item.ID)) > 0 {
			tk.in = l.Item
			tk.legs = append(tk.legs, itemLegs(l.Item, ledger.EscrowPool(l.ID), acc)...)
		}
	case KindBurgle:
		k, _ := g.TheftKind(KindBurgle)
		fi, ok := ledger.StoreOf(th.Source)
		if !ok || fi >= len(g.World.Factions) || k.GoodsPerUnit <= 0 {
			return tk
		}
		room := g.World.Factions[fi].Stock / k.GoodsPerUnit
		for _, s := range th.Goods {
			if u := min(s.Qty, g.Ledger.Of(th.Source, ledger.Goods(s.Material)), room); u > 0 {
				room -= u
				tk.goods = item.AddSpoil(tk.goods, s.Material, u)
				tk.legs = append(tk.legs, ledger.Pair(th.Source, dest, ledger.Goods(s.Material), u)...)
			}
		}
	case KindWaylay:
		if g.castCaravan(th.Caravan) == nil {
			return tk
		}
		for _, s := range th.Goods {
			asset := ledger.Goods(s.Material)
			var held int64
			for _, b := range caravanHolds(g) {
				if b.Account == th.Source && b.Asset == asset {
					held = b.Units
				}
			}
			if u := min(s.Qty, held); u > 0 {
				tk.goods = item.AddSpoil(tk.goods, s.Material, u)
				tk.legs = append(tk.legs, ledger.Pair(th.Source, dest, asset, u)...)
			}
		}
	}
	tk.worth = tk.coin
	for _, s := range tk.goods {
		tk.worth += g.WorthAt(th.At, ledger.Goods(s.Material), s.Qty)
	}
	if tk.in != nil {
		tk.worth += g.ItemValue(tk.in)
	}
	return tk
}

// listingOf is a listing by id.
func (g *Game) listingOf(id string) (*market.Listing, bool) {
	if g.Market == nil || id == "" {
		return nil, false
	}
	i := slices.IndexFunc(g.Market.Listings, func(l market.Listing) bool { return l.ID == id })
	if i < 0 {
		return nil, false
	}
	return &g.Market.Listings[i], true
}

// theftSource reports whether a theft may take from an account: an NPC's
// purse, a faction's store, a caravan, or the escrow of a listing an NPC
// sells. Never a character, a source, a sink or any other pool.
func (g *Game) theftSource(acc string) bool {
	if _, ok := ledger.NPCOf(acc); ok {
		return true
	}
	if ledger.IsStore(acc) || ledger.IsCaravan(acc) {
		return true
	}
	if !ledger.IsEscrow(acc) {
		return false
	}
	l, ok := g.listingOf(strings.TrimPrefix(acc, ledger.EscrowPool("")))
	if !ok {
		return false
	}
	_, npcSells := ledger.NPCOf(l.Seller)
	return npcSells
}

// theftResolved writes a theft's end: theft.made, and for one that took
// anything or was caught the alignment it costs; seen or caught, the
// standing lost, the watch's Wanted entry, the victim's memory and any
// betrayal. Last, a fence may come for the thief.
func (g *Game) theftResolved(c *Char, th *Theft, outcome string, tk taking, seen bool, t int64, key string) error {
	madeBefore := char.IsMade(c.C)
	standingBefore := c.C.Standing.Get(th.Faction)
	txn := ledger.Txn{Key: ledger.SubKey(key, txnTheft), Kind: txnTheft, Tick: t, Legs: ledger.Merge(tk.legs)}
	if outcome == theftWon {
		for _, l := range txn.Legs {
			if l.Units < 0 && !g.theftSource(l.Account) {
				return fmt.Errorf("theft: %s is no account a theft may take from", l.Account)
			}
		}
		if err := g.Ledger.Check(txn); err != nil {
			return err
		}
	}
	worth := tk.worth
	var loss, delta int64
	if seen && th.Faction != "" && outcome != theftEmpty {
		loss = max(g.theftCell("standing-least"), worth/max(g.theftCell("standing-coin"), 1))
		gp := g.r.Growth.Params()
		delta = min(sheets.IntParam(gp, "standing-max"), max(sheets.IntParam(gp, "standing-min"), standingBefore-loss)) - standingBefore
	}
	material := ""
	if len(tk.goods) > 0 {
		material = tk.goods[0].Material
	}
	itemID := ""
	if tk.in != nil {
		itemID = tk.in.ID
	}
	data := []fact.Datum{fact.S("kind", th.Kind), fact.S("outcome", outcome), fact.B("witnessed", seen), fact.N("worth", worth),
		fact.N("coin", tk.coin), fact.N("units", tk.units()), fact.S("material", material), fact.S("item", itemID),
		fact.S("faction", th.Faction), fact.N("settlement", int64(th.Place)), fact.N("standing", delta)}
	if th.Side != "" {
		data = append(data, fact.S("side", th.Side))
	}
	var also []fact.Ref
	if r, ok := fact.ParseRef(th.Victim); ok {
		also = append(also, r)
	}
	f, err := g.factWith(c, also, factTheft, t, append(data, fact.At(th.At)...)...)
	if err != nil {
		return err
	}
	if outcome == theftEmpty {
		return g.fenceCheck(c, t)
	}
	mark := g.hotMark(th.Victim, th.Faction, th.At, t)
	if outcome == theftWon {
		txn.Fact = f.ID
		if err := g.liftHaul(c, th, tk, txn); err != nil {
			return err
		}
		if th.Side == "" {
			g.markHot(c, tk.goods, mark)
			if tk.in != nil {
				m := mark
				tk.in.Hot = &m
			}
		}
		if th.Kind == KindBurgle {
			k, _ := g.TheftKind(KindBurgle)
			if fi, ok := ledger.StoreOf(th.Source); ok && fi < len(g.World.Factions) {
				g.World.Factions[fi].Stock -= k.GoodsPerUnit * item.Total(tk.goods)
			}
			if th.Place >= 0 {
				g.noteBurglary(th.Place, t)
			}
		}
	}
	if _, err := g.moveAlignment(c, ActTheft, g.actMove(ActTheft, worth), f.ID, "", seen, t); err != nil {
		return err
	}
	betrayed := ""
	if seen {
		if err := g.loseStanding(c, th.Faction, loss, f.ID, t); err != nil {
			return err
		}
		g.wantedFor(c, th, tk, f.ID, t)
		if th.Faction != "" && standingBefore >= g.theftCell("betray-at") {
			betrayed = th.Faction
			if err := g.betray(c, th.Faction, ActTheft, f.ID, t); err != nil {
				return err
			}
		}
	}
	if madeBefore && isFenceID(th.NPC) && betrayed != syndicateKey {
		if err := g.betray(c, syndicateKey, ActTheft, f.ID, t); err != nil {
			return err
		}
	}
	if err := g.robbed(c, th, tk, f, seen, t); err != nil {
		return err
	}
	g.touchOnce(c)
	return g.fenceCheck(c, t)
}

// liftHaul posts a won theft's haul: a lifted listing comes down first,
// and the item follows its legs into the pack.
func (g *Game) liftHaul(c *Char, th *Theft, tk taking, txn ledger.Txn) error {
	var moved []*item.Instance
	if tk.in != nil {
		if l, ok := g.listingOf(th.Listing); ok && l.Item.ID == tk.in.ID {
			g.Market.takeListing(l.ID)
			g.Market.Held = slices.DeleteFunc(g.Market.Held, func(h Held) bool { return h.Item == tk.in.ID })
		}
		moved = append(moved, tk.in)
	}
	return g.postAll(txn, moved...)
}

// loseStanding is a seen theft's cost with its victim's faction; the
// syndicate's goes through its own standing, which can unmake.
func (g *Game) loseStanding(c *Char, faction string, loss int64, cause fact.ID, t int64) error {
	if faction == "" || loss <= 0 {
		return nil
	}
	if faction == syndicateKey {
		return g.addSyndicateStanding(c, -loss, cause, t)
	}
	g.adjustStanding(c, faction, -loss)
	return nil
}

// wantedFor puts a seen or caught theft on the watch's list for wanted-days:
// what it took, from where, and its worth (GDD 5.5).
func (g *Game) wantedFor(c *Char, th *Theft, tk taking, cause fact.ID, t int64) {
	w := char.Wanted{Victim: th.Victim, Faction: th.Faction, Place: th.Place, Worth: tk.worth, Coin: tk.coin,
		Goods: slices.Clone(tk.goods), Source: th.Source, Fact: int64(cause), Ends: t + g.hotCell("wanted-days")*sheets.TicksPerDay}
	if tk.in != nil {
		w.Items = []string{tk.in.ID}
	}
	a := c.C.Align()
	a.Wanted = append(a.Wanted, w)
	g.wantedCondition(c)
}

// robbed leaves a lift on its victim's memory: naming the thief when it
// was seen or caught, no one when not.
func (g *Game) robbed(c *Char, th *Theft, tk taking, f fact.Fact, seen bool, t int64) error {
	if th.Kind != KindLift || th.NPC == "" {
		return nil
	}
	n, err := g.victimSaved(c, th.NPC, t)
	if err != nil || n == nil {
		return err
	}
	e := npc.Entry{Kind: entryRobbed, Weight: f.Weight, Tick: t, Fact: int64(f.ID), Thing: g.robbedThing(tk), N: tk.worth}
	if seen {
		e.Player = c.C.ID
		if err := g.note(n, c, e, t); err != nil {
			return err
		}
	} else {
		g.r.NPC.Remember(n, e, t)
	}
	return g.NPCs.Touched(n)
}

// robbedThing is what a lift took, in words an NPC's memory keeps.
func (g *Game) robbedThing(tk taking) string {
	switch {
	case tk.in != nil:
		return g.KindName(tk.in.Kind)
	case tk.coin > 0:
		return ledger.Coin
	}
	return ""
}

// victimSaved is the NPC a lift was from, saved on the spot if nobody
// has met it.
func (g *Game) victimSaved(c *Char, id string, t int64) (*npc.NPC, error) {
	if n := g.NPCs.Get(id); n != nil {
		return n, nil
	}
	s, _, ok := g.personOf(c, id)
	if !ok {
		return nil, nil
	}
	n := g.NPCs.Save(s, t)
	old := n.Route
	g.r.NPC.LayRoute(n, t, g.routeCost)
	g.NPCs.Routed(n, old)
	return n, nil
}

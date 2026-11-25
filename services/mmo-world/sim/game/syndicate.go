package game

import (
	"cmp"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// The syndicate's trade (GDD 4.5): its fences buy hot goods, its dens post
// jobs for the made, and a den's back room makes hot goods clean. Every
// coin it pays is carved out of a settlement's day budget, so it stays
// inside the faucet (GDD 10.2).

// structural: the ledger kinds of a fence sale and a job's escrow, the
// stations a back room works, and what the character earned it as.
const (
	txnFence     = "fence"
	txnJob       = "job"
	stationForge = "forge"
	stationBench = "bench"
	earnedFence  = "fence"
)

func init() {
	crimeCommands[Fence] = (*Game).fence
}

// syp is a factions.syndicate cell.
func (g *Game) syp(id string) int64 { return sheets.IntParam(g.r.Book.SyndicateParams, id) }

// fenceHere is the den on the character's tile whose fence it can find
// there now, and the fence.
func (g *Game) fenceHere(c *Char) (Den, npc.Stub, bool) {
	d, ok := g.DenAt(c.C.At)
	if !ok {
		return Den{}, npc.Stub{}, false
	}
	for _, p := range g.PeopleHere(c, c.C.At) {
		if p.Fence && p.ID == d.Fence {
			return d, p.Stub, true
		}
	}
	return Den{}, npc.Stub{}, false
}

// FencePays is what the fence here pays a character for goods of a worth:
// the fence's share, or the back room's for the made.
func (g *Game) FencePays(c *Char, worth int64) int64 {
	pct := g.syp("fence-pays")
	if char.IsMade(c.C) {
		pct = g.syp("back-room-pays")
	}
	return fixed.PercentFloor(worth, pct)
}

// earned adds coin to a carry worth a standing point per per coin: the
// whole points, and the remainder carried on.
func earned(carry, coin, per int64) (points, rest int64) {
	if per <= 0 {
		return 0, carry
	}
	sum := carry + coin
	return sum / per, sum % per
}

// fence sells hot goods, units of a material or one item, to the fence
// here, out of the settlement's trader coin for the day. The goods go into
// the fence's purse, which the world day empties into the syndicate's
// sink, so they never come back to a market.
func (g *Game) fence(c *Char, cmd Command) error {
	if err := canTrade(c); err != nil {
		return err
	}
	t := g.Tick()
	day := t / sheets.TicksPerDay
	d, stub, ok := g.fenceHere(c)
	if !ok {
		return refuse(FenceHidden, "no fence here deals with %s", c.C.ID)
	}
	if _, err := g.tradeMood(c, stub); err != nil {
		return err
	}
	acc, purse := ledger.Char(c.C.ID), ledger.NPCPool(d.Fence)
	var legs []ledger.Leg
	var moved []*item.Instance
	var worth, units int64
	var data []fact.Datum
	switch {
	case cmd.Item != "":
		in, err := unworn(c, cmd.Item)
		if err != nil {
			return err
		}
		if in.Staged != nil {
			return refuse(StagedLocal, "%s is made of staged goods: no fence buys it, only players where it was staged", in.ID)
		}
		if !in.Hot.HotOn(day) {
			return refuse(NotHot, "%s is not hot: a fence buys only hot goods", in.ID)
		}
		worth, units, moved = g.ItemValue(in), 1, []*item.Instance{in}
		legs = itemLegs(in, acc, purse)
		data = append(data, fact.S("item", in.ID), fact.S("kind", in.Kind))
	case cmd.Material != "" && cmd.Units > 0:
		if hot := g.HotUnits(c, cmd.Material, day); hot < cmd.Units {
			return refuse(NotHot, "%s holds %d hot %s: a fence buys only hot goods", c.C.ID, hot, cmd.Material)
		}
		worth, units = g.worthOf(c.C.At, cmd.Material, cmd.Units), cmd.Units
		legs = ledger.Pair(acc, purse, ledger.Goods(cmd.Material), cmd.Units)
		data = append(data, fact.S("material", cmd.Material))
	default:
		return refuse(BadArgs, "a fence buys an item, or units of a material")
	}
	pay := g.FencePays(c, worth)
	if pay < 1 {
		return refuse(BadArgs, "the fence gives nothing for goods worth %d coin", worth)
	}
	if left, ok := g.traderLeft(d.Place); !ok || left < pay {
		return refuse(FenceSpent, "the fence has spent today's coin; it pays %d coin and has %d coin left", pay, left)
	}
	n, err := g.denNPC(d, t)
	if err != nil {
		return err
	}
	a := c.C.Align()
	points, rest := earned(a.Fenced, pay, g.syp("fence-standing-coin"))
	restore := holdMarks(c, moved)
	if cmd.Item == "" {
		g.takeHot(c, cmd.Material, cmd.Units, day)
	}
	f, err := g.npcFact(c, n, factFenceBought, t, append(data, fact.N("units", units), fact.N("worth", worth), fact.N("pay", pay),
		fact.N("standing", points), fact.N("settlement", int64(d.Place)))...)
	if err != nil {
		restore()
		return err
	}
	legs = append(legs, ledger.Pair(ledger.FromFaction, acc, ledger.Coin, pay)...)
	if err := g.postAll(ledger.Txn{Key: cmd.Key, Kind: txnFence, Tick: t, Fact: f.ID, Legs: legs}, moved...); err != nil {
		restore()
		return err
	}
	g.spendTrader(c, d.Place, pay, earnedFence)
	a.Fenced = rest
	g.touchOnce(c)
	if points > 0 {
		return g.addSyndicateStanding(c, points, f.ID, t)
	}
	return nil
}

// takeHot takes units of a material out of a character's live lots, oldest
// first, for one who wants the hot units themselves: a fence, a back room.
// Call it before the units leave; it returns what left the lots.
func (g *Game) takeHot(c *Char, material string, units, day int64) []char.HotLot {
	a := c.C.Alignment
	if a == nil || len(a.Hot) == 0 || units <= 0 {
		return nil
	}
	held := g.hotHeld(c, material)
	trimHot(c, material, held, day)
	var out []char.HotLot
	for i := range a.Hot {
		l := &a.Hot[i]
		if units <= 0 {
			break
		}
		if l.Material != material || l.Units <= 0 {
			continue
		}
		cut := min(units, l.Units)
		l.Units -= cut
		units -= cut
		out = append(out, char.HotLot{Material: material, Units: cut, Mark: l.Mark})
	}
	trimHot(c, material, held, day)
	g.touchOnce(c)
	return out
}

// latestMark is the mark of the lot that stays hot longest, the first on a
// tie: what a product made from them carries.
func latestMark(lots []char.HotLot) (item.Hot, bool) {
	if len(lots) == 0 {
		return item.Hot{}, false
	}
	best := lots[0].Mark
	for _, l := range lots[1:] {
		if l.Mark.Ends > best.Ends {
			best = l.Mark
		}
	}
	return best, true
}

// Jobs.

// madeActive reports whether any made character is playing.
func (g *Game) madeActive() bool {
	for c := range g.activeChars() {
		if char.IsMade(c.C) {
			return true
		}
	}
	return false
}

// jobPosted reports whether a goal is a syndicate job on a settlement's
// board with a reward: its reward left the day budget when it was posted.
func jobPosted(x *Goal, n int) bool {
	return x.Board == n && x.Issuer.Kind == goal.BySyndicate && x.Reward > 0
}

// jobOpen reports whether a settlement's board still holds a live job.
func (g *Game) jobOpen(n int) bool {
	return slices.ContainsFunc(g.Goals, func(x *Goal) bool {
		return x.Board == n && x.Issuer.Kind == goal.BySyndicate && x.State == goal.Live
	})
}

// jobTarget is the faction a den's job robs: of the living factions whose
// seat region or a held settlement lies within job-reach of the den, the
// one with the most stock, the lowest index on a tie. near: it holds a
// settlement in reach, whose store can be burgled.
func (g *Game) jobTarget(d Den) (fi int, near, ok bool) {
	reach := g.syp("job-reach")
	fi = -1
	for i, f := range g.World.Factions {
		if f.Fallen {
			continue
		}
		seat := f.Seat >= 0 && f.Seat < len(g.World.Regions) && g.World.Regions[f.Seat].Holder == i &&
			hex.Distance(g.regionHex(f.Seat), d.At) <= reach
		held := g.holdsSettlementNear(i, d.At, reach)
		if !seat && !held {
			continue
		}
		if fi < 0 || f.Stock > g.World.Factions[fi].Stock {
			fi, near = i, held
		}
	}
	return fi, near, fi >= 0
}

// holdsSettlementNear reports whether a faction holds the region of an
// open settlement within reach of h.
func (g *Game) holdsSettlementNear(fi int, h hex.Hex, reach int64) bool {
	return slices.ContainsFunc(g.Places, func(p *Place) bool {
		return p.Ruined == 0 && hex.Distance(p.Hex, h) <= reach && g.holderAt(p.Hex) == fi
	})
}

// syndicateJobs posts each den's job for the day while any made character
// plays (GDD 4.5): a Steal from the richest faction near the den, worth
// job-worth a tier, its reward a share of the den settlement's day budget
// minted into escrow and held out of the day's orders by bountyHeld.
func (g *Game) syndicateJobs(t int64, key string) error {
	if g.Market == nil || !g.madeActive() {
		return nil
	}
	budgets := g.Budgets()
	for _, d := range g.Dens() {
		n := d.Place
		p := g.Places[n]
		if p.Ruined != 0 || !p.Open(structureMarket) || g.jobOpen(n) || n >= len(budgets) {
			continue
		}
		reward := fixed.PercentFloor(budgets[n], g.syp("job-share"))
		fi, near, ok := g.jobTarget(d)
		if !ok || reward < g.gp("reward-least") {
			continue
		}
		kind := KindLift
		if near {
			kind = KindBurgle
		}
		victim, worth := factionOwner(fi), g.syp("job-worth")*g.tierAt(d.At)
		x := &Goal{Title: cmp.Or(g.r.Name("theft.kinds:"+kind), kind) + ": " + g.FactionName(fi),
			Issuer: goal.Ref{Kind: goal.BySyndicate, ID: syndicateIssuer}, Scope: goal.World, Board: n, Reward: reward, Mode: goal.First,
			Lifetime: goal.Ephemeral, Turnover: goal.Expire, Posted: t, Expires: t + g.syp("job-days")*sheets.TicksPerDay, State: goal.Live,
			Cond: goal.Condition{Verb: goal.Steal, Kind: kind, Count: worth, Victim: victim}}
		if err := g.postPool(x, ledger.SubKey(key, txnJob, strconv.Itoa(n)), txnJob, t); err != nil {
			return err
		}
		if _, err := g.worldFact(p.Hex, factJobPosted, []fact.Ref{goalRef(x.ID), npc.Ref(d.Fence)}, nil,
			append([]fact.Datum{fact.S("verb", goal.Steal), fact.S("kind", kind), fact.S("faction", victim), fact.N("reward", reward),
				fact.N("worth", worth), fact.N("settlement", int64(n))}, fact.At(p.Hex)...)...); err != nil {
			return err
		}
	}
	return nil
}

// The back room.

// backRoom is the station a den's back room lends the made for a process:
// a forge or a bench at the settlement's tier.
func (g *Game) backRoom(c *Char, process string) (Station, error) {
	if !char.IsMade(c.C) {
		return Station{}, refuse(NotMade, "the back room is for the made")
	}
	if _, ok := g.DenAt(c.C.At); !ok {
		return Station{}, refuse(NoDen, "no den stands here")
	}
	kinds := g.r.processStations[process]
	for _, kind := range []string{stationForge, stationBench} {
		if slices.Contains(kinds, kind) {
			return Station{Kind: kind, Tier: g.tierAt(c.C.At)}, nil
		}
	}
	return Station{}, refuse(NotHere, "the back room has no station that does %s", process)
}

// BackRoomFee is what a back room charges for a recipe: its station's fee
// and launder-percent of the worth of every input, hot or not, with no
// other modifier.
func (g *Game) BackRoomFee(c *Char, st Station, r item.Recipe) int64 {
	var worth int64
	for _, in := range r.Inputs {
		worth += g.worthOf(c.C.At, in.Kind, in.Qty)
	}
	return g.StationFee(st) + fixed.PercentFloor(worth, g.syp("launder-percent"))
}

// launder takes a back-room craft's consumed units out of the lots first,
// so the hot units are the ones made clean, and returns their worth.
func (g *Game) launder(c *Char, consumed []item.Spoil, day int64) int64 {
	var worth int64
	for _, s := range consumed {
		for _, l := range g.takeHot(c, s.Material, s.Qty, day) {
			worth += g.worthOf(c.C.At, l.Material, l.Units)
		}
	}
	return worth
}

// laundered records a back-room craft: its fee and the hot worth it made
// clean, a syndicate standing point per launder-standing-coin of it.
func (g *Game) laundered(c *Char, fee, worth int64, res craft.Result, t int64) error {
	a := c.C.Align()
	points, rest := earned(a.Laundered, worth, g.syp("launder-standing-coin"))
	data := []fact.Datum{fact.N("fee", fee), fact.N("worth", worth), fact.N("standing", points)}
	if res.Kind != nil {
		data = append(data, fact.S("kind", res.Kind.ID))
	}
	f, err := g.fact(c, factLaundered, t, append(data, fact.At(c.C.At)...)...)
	if err != nil {
		return err
	}
	a.Laundered = rest
	g.touchOnce(c)
	if points > 0 {
		return g.addSyndicateStanding(c, points, f.ID, t)
	}
	return nil
}

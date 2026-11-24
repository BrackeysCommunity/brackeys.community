package game

import (
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/ledger"
)

// ruin turns place n to a ruin (GDD 4.8). It keeps its index, so
// everything that names it still reads: its market's orders go back with
// their escrow, its board's goals end with their refunds, its treasury
// goes to the guild that ran it, every structure closes, and nobody runs
// it. Side goals on its board stay the director's to end. Goods waiting on
// the tile stay there for whoever they wait for.
func (g *Game) ruin(n int, t int64) error {
	if n < 0 || n >= len(g.Places) || g.Places[n].Ruined != 0 {
		return nil
	}
	p := g.Places[n]
	key := ledger.SubKey("ruin", itoa(n), i64(t))
	var opens []Open
	for o := range g.opens("", false) {
		if o.Settlement == n {
			opens = append(opens, o)
		}
	}
	for _, o := range opens {
		if err := g.closeOrder(o, ledger.SubKey(key, "order", o.ID)); err != nil {
			return err
		}
	}
	for _, x := range g.Goals {
		if x.Board != n || !x.Open() || x.Cond.Verb == goal.Back {
			continue
		}
		if err := g.endGoal(x, Ruined, key); err != nil {
			return err
		}
	}
	guild := p.Guild
	to := ledger.ToFees
	if gd := g.GuildOf(guild); gd != nil {
		to = gd.Pool()
	}
	var legs []ledger.Leg
	var coin int64
	for _, h := range g.Ledger.Held(TreasuryPool(n)) {
		legs = append(legs, ledger.Pair(TreasuryPool(n), to, h.Asset, h.Units)...)
		if h.Asset == ledger.Coin {
			coin = h.Units
		}
	}
	if len(legs) > 0 {
		if err := g.post(ledger.Txn{Key: ledger.SubKey(key, "treasury"), Kind: "ruin", Tick: t, Legs: legs}); err != nil {
			return err
		}
	}
	for i := range p.Structures {
		p.Structures[i].Condition = 0
	}
	if err := g.holdDen(n, t); err != nil {
		return err
	}
	// Ruined 0 reads as standing, so a ruin in the world's first tick is
	// dated a tick on.
	p.Guild, p.City, p.Ruined = "", nil, max(t, 1)
	if g.Market != nil && n < len(g.Market.Trader) {
		g.Market.Trader[n] = 0
	}
	subjects := []fact.Ref{arc.SettlementRef(n)}
	data := []fact.Datum{fact.N("settlement", int64(n)), fact.N("treasury", coin)}
	if guild != "" {
		subjects = append(subjects, guildRef(guild))
		data = append(data, fact.S("guild", guild))
	}
	if p.Faction != nil {
		subjects = append(subjects, arc.FactionRef(*p.Faction))
	}
	_, err := g.worldFact(p.Hex, "settlement.ruined", subjects, nil, append(data, fact.At(p.Hex)...)...)
	return err
}

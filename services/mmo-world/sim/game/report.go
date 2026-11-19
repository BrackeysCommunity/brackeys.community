package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
	"jams.team/mmo-world/sim/world"
)

// Week is what the weekly ledger report adds up as the week goes.
type Week struct {
	From    int64       `json:"from"` // the world day it began
	Faucet  int64       `json:"faucet"`
	Fees    int64       `json:"fees"`
	Between int64       `json:"between"` // coin that changed hands between characters
	Traded  tally.Tally `json:"traded"`  // units by material
}

func newWeek(day int64) Week { return Week{From: day, Traded: tally.Tally{}} }

func (w *Week) fill(material string, units, coin int64, faction bool) {
	w.Traded.Bump(material, units)
	if faction {
		w.Faucet += coin
	} else {
		w.Between += coin
	}
}

// Report is the weekly ledger report (GDD 10.5): supply in coin, coin per
// active character against the band, how often a coin changes hands a
// day, the most traded goods and what staged events put in.
type Report struct {
	Day       int64    `json:"day"`
	Fact      fact.ID  `json:"fact"`
	Supply    int64    `json:"supply"`
	Active    int64    `json:"active"`
	PerActive int64    `json:"perActive"` // the stabiliser's mean
	Low       int64    `json:"low"`
	High      int64    `json:"high"`
	Rate      fixed.F  `json:"rate"`     // the faucet, coin per active character per day
	Velocity  fixed.F  `json:"velocity"` // coin changing hands per coin per day
	Faucet    int64    `json:"faucet"`   // coin faction orders paid this week
	Fees      int64    `json:"fees"`
	Top       []Traded `json:"top"`
	Staged    int64    `json:"staged"`
	Audit     int      `json:"audit"` // discrepancies the conservation check found
}

// Traded is units of one material traded in a week.
type Traded struct {
	Material string `json:"material"`
	Units    int64  `json:"units"`
}

// structural: a report names the three most traded goods.
const topTraded = 3

// Supply is the coin characters hold, in hand and in escrow.
func (g *Game) Supply() int64 {
	var n int64
	for _, b := range g.Ledger.Balances {
		if b.Asset == ledger.Coin && (strings.HasPrefix(b.Account, ledger.Holder) || strings.HasPrefix(b.Account, escrowPrefix)) {
			n += b.Units
		}
	}
	return n
}

// ActiveCoin is the coin active characters hold, in hand and in escrow,
// and how many they are: what the stabiliser steers by. Coin a character
// who stopped playing holds is out of circulation until it comes back.
func (g *Game) ActiveCoin() (coin, active int64) {
	since := g.Tick() - g.mp("active-days")*sheets.TicksPerDay
	live := map[string]bool{}
	for _, c := range g.Chars {
		if c.Acted >= since && !c.Banned {
			live[ledger.Char(c.C.ID)] = true
			coin += c.C.Coin
			active++
		}
	}
	if m := g.Market; m != nil {
		for _, b := range m.Books {
			for _, o := range b.Bids {
				if live[o.Owner] {
					coin += g.Ledger.Of(EscrowOf(o.ID), ledger.Coin)
				}
			}
		}
		for _, w := range m.Wants {
			if live[w.Buyer] {
				coin += w.Price
			}
		}
	}
	return coin, active
}

// worldFact writes a fact of a sheet-weighed kind at a tile, about the
// subjects named.
func (g *Game) worldFact(h hex.Hex, kind string, subjects []fact.Ref, causes []fact.ID, data ...fact.Datum) (fact.ID, error) {
	region := ""
	if r := g.World.RegionAt(h); r >= 0 {
		region = world.RegionRef(r)
	}
	f, err := g.r.weights.New(g.Tick(), kind, region, subjects, causes, data...)
	if err != nil {
		return 0, err
	}
	return g.Log.Append(f)
}

// notable keeps a trade among its settlement's most valuable today.
func (g *Game) notable(t Trade) {
	m := g.Market
	m.Notable = append(m.Notable, t)
	slices.SortStableFunc(m.Notable, func(a, b Trade) int {
		return cmp.Or(cmp.Compare(a.Settlement, b.Settlement), cmp.Compare(b.Coin(), a.Coin()))
	})
	most := g.mp("notable-trades")
	var kept []Trade
	count := map[int]int64{}
	for _, x := range m.Notable {
		if count[x.Settlement] < most {
			kept = append(kept, x)
			count[x.Settlement]++
		}
	}
	m.Notable = kept
}

// dayTurn is the market's world day: expired orders go back, books close
// the day, the stabiliser moves the faucet, the week's report is posted
// when due, and the new day's faction orders stand.
func (g *Game) dayTurn(t int64) error {
	if err := g.ensureMarket(); err != nil {
		return err
	}
	m := g.Market
	day := t / sheets.TicksPerDay
	if err := g.expire(t); err != nil {
		return err
	}
	for _, b := range m.Books {
		b.CloseDay(day-1, t, g.mp("history-days"), int64(g.cause(b.Settlement, t)))
	}
	m.Yesterday, m.Notable = m.Notable, []Trade{}
	held, active := g.ActiveCoin()
	supply := g.Supply()
	per := int64(0)
	if active > 0 {
		per = held / active
	}
	mean, move := m.Faucet.Step(per, g.r.Faucet)
	if _, err := g.worldFact(g.r.Gen.Settlement(0).Hex, "faucet.moved", nil, nil, fact.S("move", move), fact.N("perActive", mean),
		fact.N("rate", m.Faucet.Rate.Floor())); err != nil {
		return err
	}
	if day-m.Week.From >= g.mp("report-days") {
		if err := g.report(day, supply, active, mean); err != nil {
			return err
		}
	}
	return g.postFactionOrders(t)
}

// cause is the heaviest news near a settlement in the day before t, which
// a mover names.
func (g *Game) cause(settlement int, t int64) fact.ID {
	h := g.r.Gen.Settlement(settlement).Hex
	near := g.r.NPC.Param("news-range")
	var best News
	for _, n := range g.News {
		if n.Tick < t-sheets.TicksPerDay || n.Placeless || hex.Distance(n.At, h) > near {
			continue
		}
		if n.Weight > best.Weight {
			best = n
		}
	}
	return best.ID
}

// report posts the weekly ledger report as a fact and keeps it.
func (g *Game) report(day, supply, active, mean int64) error {
	m := g.Market
	w := m.Week
	days := max(1, day-w.From)
	r := Report{Day: day, Supply: supply, Active: active, PerActive: mean, Low: g.r.Faucet.Low, High: g.r.Faucet.High,
		Rate: m.Faucet.Rate, Faucet: w.Faucet, Fees: w.Fees}
	if supply > 0 {
		r.Velocity = fixed.Ratio(w.Between, supply*days)
	}
	for _, x := range w.Traded {
		r.Top = append(r.Top, Traded{Material: x.Key, Units: x.N})
	}
	slices.SortStableFunc(r.Top, func(a, b Traded) int { return cmp.Compare(b.Units, a.Units) })
	r.Top = r.Top[:min(len(r.Top), topTraded)]
	r.Audit = len(ledger.Audit(g.Ledger.Balances, g.Holdings()))
	data := []fact.Datum{fact.N("supply", supply), fact.N("active", active), fact.N("perActive", mean), fact.N("faucet", w.Faucet),
		fact.N("between", w.Between), fact.N("fees", w.Fees)}
	for i, x := range r.Top {
		data = append(data, fact.S("top"+strconv.Itoa(i), x.Material), fact.N("units"+strconv.Itoa(i), x.Units))
	}
	id, err := g.worldFact(g.r.Gen.Settlement(0).Hex, "ledger.report", nil, nil, data...)
	if err != nil {
		return err
	}
	r.Fact = id
	m.Reports = append(m.Reports, r)
	if over := len(m.Reports) - reportsKept; over > 0 {
		m.Reports = m.Reports[over:]
	}
	m.Week = newWeek(day)
	return nil
}

// structural: the reports a market keeps for its card.
const reportsKept = 8

// expire gives back the escrow of every order, listing and gear order
// whose time is up.
func (g *Game) expire(t int64) error {
	m := g.Market
	key := func(id string) string { return ledger.SubKey("tick", strconv.FormatInt(t, decimal), "expire", id) }
	for _, b := range m.Books {
		for _, o := range b.Expire(t) {
			if o.Faction == nil {
				if err := g.unescrow(o.ID, o.Owner, key(o.ID)); err != nil {
					return err
				}
			}
		}
	}
	for i := 0; i < len(m.Listings); {
		if m.Listings[i].Expires > t {
			i++
			continue
		}
		if err := g.unlist(i, key(m.Listings[i].ID)); err != nil {
			return err
		}
	}
	keep := m.Wants[:0]
	for _, w := range m.Wants {
		if w.Expires > t {
			keep = append(keep, w)
			continue
		}
		if err := g.unescrow(w.ID, w.Buyer, key(w.ID)); err != nil {
			return err
		}
	}
	m.Wants = keep
	return nil
}

// Movers are the books whose price moved most over the window, with the
// fact behind each.
type Mover struct {
	Settlement int     `json:"settlement"`
	Material   string  `json:"material"`
	Change     int64   `json:"change"` // per cent
	Last       int64   `json:"last"`
	Cause      fact.ID `json:"cause,omitempty"`
}

// Movers lists a settlement's biggest rises and falls over days, largest
// change first.
func (g *Game) Movers(settlement int, days int) []Mover {
	if g.Market == nil {
		return nil
	}
	var out []Mover
	for _, b := range g.Market.Books {
		if b.Settlement != settlement {
			continue
		}
		ch, ok := b.Change(days)
		if !ok || ch == 0 {
			continue
		}
		mv := Mover{Settlement: settlement, Material: b.Material, Change: ch, Last: b.Last}
		for i := len(b.Days) - 1; i >= max(0, len(b.Days)-days) && mv.Cause == 0; i-- {
			mv.Cause = fact.ID(b.Days[i].Cause)
		}
		out = append(out, mv)
	}
	slices.SortStableFunc(out, func(a, b Mover) int { return cmp.Compare(abs(b.Change), abs(a.Change)) })
	return out
}

func abs(n int64) int64 { return max(n, -n) }

// BooksAt are a settlement's books.
func (g *Game) BooksAt(settlement int) []*market.Book {
	if g.Market == nil {
		return nil
	}
	var out []*market.Book
	for _, b := range g.Market.Books {
		if b.Settlement == settlement {
			out = append(out, b)
		}
	}
	return out
}

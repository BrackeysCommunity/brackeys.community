package game

import (
	"cmp"
	"iter"
	"slices"
	"strconv"

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

// faucet counts coin the factions and traders paid characters.
func (w *Week) faucet(coin int64) { w.Faucet += coin }

// between counts coin that changed hands between characters.
func (w *Week) between(coin int64) { w.Between += coin }

// fee counts a fee taken.
func (w *Week) fee(coin int64) { w.Fees += coin }

// traded counts units of a material traded.
func (w *Week) traded(material string, units int64) { w.Traded.Bump(material, units) }

// Report is the weekly ledger report (GDD 10.5): supply in coin, coin per
// active character against the band, how often a coin changes hands a
// day, and the most traded goods.
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
	supply, _, _ := g.coinHeld()
	return supply
}

// coinHeld is the coin characters hold, in hand and in escrow; the part
// of it active characters hold; and how many they are. The stabiliser
// steers by the active part: coin a character who stopped playing holds
// is out of circulation until it comes back, as is coin in a guild's or a
// settlement's treasury until it is paid out. A reward a character put up
// is still that character's until it is claimed.
func (g *Game) coinHeld() (supply, active, n int64) {
	live := map[string]bool{}
	for c := range g.activeChars() {
		live[ledger.Char(c.C.ID)] = true
		n++
	}
	owner := map[string]string{}
	for o := range g.opens("", false) {
		owner[ledger.EscrowPool(o.ID)] = o.Owner
	}
	for _, x := range g.Goals {
		if _, ok := ledger.CharOf(backer(x)); ok && x.Open() {
			owner[goalPool(x.ID)] = backer(x)
		}
	}
	for _, b := range g.Ledger.Balances {
		if b.Asset != ledger.Coin {
			continue
		}
		acc := b.Account
		if _, isChar := ledger.CharOf(acc); !isChar {
			if !ledger.IsEscrow(acc) {
				continue
			}
			acc = owner[acc]
		}
		supply += b.Units
		if live[acc] {
			active += b.Units
		}
	}
	return supply, active, n
}

// active reports whether a character acted within active-days and is not
// banned.
func (g *Game) active(c *Char) bool {
	return c.Acted >= g.Tick()-g.mp("active-days")*sheets.TicksPerDay && !c.Banned
}

// activeChars are the active characters.
func (g *Game) activeChars() iter.Seq[*Char] {
	return func(yield func(*Char) bool) {
		for _, c := range g.Chars {
			if g.active(c) && !yield(c) {
				return
			}
		}
	}
}

// worldFact writes a fact of a sheet-weighed kind at a tile, about the
// subjects named.
func (g *Game) worldFact(h hex.Hex, kind string, subjects []fact.Ref, causes []fact.ID, data ...fact.Datum) (fact.ID, error) {
	region := ""
	if r := g.World.RegionAt(h); r >= 0 {
		region = world.RegionRef(r)
	}
	return g.regionFact(region, kind, subjects, causes, data...)
}

// regionFact writes a fact of a sheet-weighed kind in a region, by the
// world's ref for it.
func (g *Game) regionFact(region, kind string, subjects []fact.Ref, causes []fact.ID, data ...fact.Datum) (fact.ID, error) {
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
	// Advance sets the clock to t only after this turn; date what the turn
	// writes, fills included, at t.
	was := g.World.Tick
	g.World.Tick = t
	defer func() { g.World.Tick = was }()
	// A game saved before markets existed gets one here, so loading it
	// keeps its digest.
	if g.Market == nil {
		g.Market = g.newMarket()
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
	g.tradeDay(day - 1)
	supply, held, active := g.coinHeld()
	per := int64(0)
	if active > 0 {
		per = held / active
	}
	mean, move := m.Faucet.Step(per, g.r.Faucet)
	if _, err := g.worldFact(g.SettlementHex(0), "faucet.moved", nil, nil, fact.S("move", move), fact.N("perActive", mean),
		fact.N("rate", m.Faucet.Rate.Floor())); err != nil {
		return err
	}
	if day-m.Week.From >= g.mp("report-days") {
		if err := g.report(day, supply, active, mean); err != nil {
			return err
		}
	}
	if err := g.placesTurn(t); err != nil {
		return err
	}
	if err := g.guildsTurn(t); err != nil {
		return err
	}
	if err := g.goalsTurn(t); err != nil {
		return err
	}
	if err := g.delveDay(day); err != nil {
		return err
	}
	if err := g.huntsDay(day); err != nil {
		return err
	}
	if err := g.emergenceDay(t); err != nil {
		return err
	}
	if g.Story != nil {
		if err := g.storyDay(t); err != nil {
			return err
		}
	}
	if err := g.houseDay(day); err != nil {
		return err
	}
	return g.postFactionOrders(t)
}

// cause is the heaviest news near a settlement in the day before t, which
// a mover names.
func (g *Game) cause(settlement int, t int64) fact.ID {
	h := g.SettlementHex(settlement)
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
	id, err := g.worldFact(g.SettlementHex(0), "ledger.report", nil, nil, data...)
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
// whose time is up, wherever its owner is: an order expires only after
// order-days, too slow to carry goods past the road.
func (g *Game) expire(t int64) error {
	var due []Open
	for o := range g.opens("", false) {
		if o.Expires <= t {
			due = append(due, o)
		}
	}
	for _, o := range due {
		if err := g.closeOrder(o, ledger.SubKey("tick", strconv.FormatInt(t, decimal), "expire", o.ID)); err != nil {
			return err
		}
	}
	return nil
}

// Mover is a book whose price moved over the window, and the fact behind
// it.
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
	return g.movers(settlement, days, func(b *market.Book) (int64, int64, bool) {
		ch, ok := b.Change(days)
		return ch, b.Last, ok
	})
}

// ClosedMovers lists a settlement's rises and falls over the world day
// just closed, largest change first.
func (g *Game) ClosedMovers(settlement int) []Mover {
	return g.movers(settlement, 1, func(b *market.Book) (int64, int64, bool) {
		ch, ok := b.ClosedChange()
		if !ok {
			return 0, 0, false
		}
		return ch, b.Days[len(b.Days)-1].Close, true
	})
}

// movers lists a settlement's books by a change in price, largest first,
// naming the cause over causeDays.
func (g *Game) movers(settlement int, causeDays int, change func(*market.Book) (ch, last int64, ok bool)) []Mover {
	var out []Mover
	for _, b := range g.BooksAt(settlement) {
		ch, last, ok := change(b)
		if !ok || ch == 0 {
			continue
		}
		out = append(out, Mover{Settlement: settlement, Material: b.Material, Change: ch, Last: last, Cause: fact.ID(b.Cause(causeDays))})
	}
	slices.SortStableFunc(out, func(a, b Mover) int { return cmp.Compare(abs(b.Change), abs(a.Change)) })
	return out
}

func abs(n int64) int64 { return max(n, -n) }

// ListingsAt are a settlement's listings.
func (g *Game) ListingsAt(settlement int) []market.Listing {
	if g.Market == nil {
		return nil
	}
	var out []market.Listing
	for _, l := range g.Market.Listings {
		if l.Settlement == settlement {
			out = append(out, l)
		}
	}
	return out
}

// CheapestListings are a settlement's cheapest listings, at most `most`
// of them: cheapest first, and among equals the one listed first.
func (g *Game) CheapestListings(settlement, most int) []market.Listing {
	if g.Market == nil {
		return nil
	}
	var out []market.Listing
	for _, l := range g.Market.Listings {
		if l.Settlement != settlement {
			continue
		}
		i, _ := slices.BinarySearchFunc(out, l.Price, func(o market.Listing, price int64) int {
			if o.Price > price {
				return 1
			}
			return -1
		})
		if i >= most {
			continue
		}
		out = slices.Insert(out[:min(len(out), most-1)], i, l)
	}
	return out
}

// WantsAt are a settlement's gear orders.
func (g *Game) WantsAt(settlement int) []market.Want {
	if g.Market == nil {
		return nil
	}
	var out []market.Want
	for _, w := range g.Market.Wants {
		if w.Settlement == settlement {
			out = append(out, w)
		}
	}
	return out
}

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

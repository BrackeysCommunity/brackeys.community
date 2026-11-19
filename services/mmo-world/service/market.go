package service

import (
	"net/http"
	"slices"
	"strings"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
)

// structural: what the market's lists show.
const (
	bookDepth    = 5  // levels each side
	moversShown  = 5  // rises and falls
	moverWindow  = 7  // world days a mover is measured over
	gearShown    = 10 // listings
	entriesShown = 8  // ledger lines in Mine
	historyShown = 30 // world days on a price chart
)

// market is /market for a character standing in a settlement: the book
// for one material, and the eight lists.
func (s *Server) market(w http.ResponseWriter, r *http.Request) {
	material := r.URL.Query().Get("material")
	var out api.Market
	var banner render.BannerInput
	var supply render.Series
	var acc string
	var refused error
	if !s.withChar(w, r, func(c *game.Char) {
		g := s.g
		if !g.HasMarket(c.C.At) {
			refused = notHere("there is no market here")
			return
		}
		n, _ := g.SettlementAt(c.C.At)
		out = apiMarket(g, c, n, material)
		banner = s.bannerInput(c.C.At)
		supply = s.supplySeries()
		acc = ledger.Char(c.C.ID)
	}) {
		return
	}
	if refused != nil {
		s.refused(w, refused)
		return
	}
	var err error
	if out.Banner, err = s.banner(banner); err != nil {
		s.internal(w, err)
		return
	}
	rows, err := s.st.LedgerOf(r.Context(), acc, entriesShown)
	if err != nil {
		s.internal(w, err)
		return
	}
	for _, x := range rows {
		out.Mine.Entries = append(out.Mine.Entries, api.Entry{Tick: x.Tick, Kind: x.Kind, Asset: x.Asset, Units: x.Units})
	}
	if out.Report != nil {
		if out.Report.Chart, err = s.picture("supply", supply, func() (*render.Canvas, error) { return render.Chart(supply), nil }); err != nil {
			s.internal(w, err)
			return
		}
	}
	reply(w, http.StatusOK, out)
}

func notHere(msg string) error { return &game.Refused{Code: game.NotHere, Msg: msg} }

func apiMarket(g *game.Game, c *game.Char, n int, material string) api.Market {
	rv := g.Rules().Values
	h := c.C.At
	out := api.Market{Settlement: n, Name: g.PlaceName(h), Exchange: []api.Exchange{}, Movers: []api.Mover{}, Elsewhere: []api.Far{},
		Gear: []api.Listing{}, Wants: []api.GearWant{}, Orders: []api.Order{}, Fee: rv.FeePercent(), Limit: rv.Param("open-orders"),
		Days: rv.Param("order-days"), PerPoint: rv.Param("standing-coin"),
		Mine: api.Mine{Open: []api.Open{}, Entries: []api.Entry{}, Young: g.Young(c), Cap: rv.Param("young-cap")}}
	books := g.BooksAt(n)
	if material == "" {
		material = busiest(books, c)
	}
	out.Material = material
	out.Book = api.BookView{Material: material, Bids: []api.Level{}, Asks: []api.Level{}, Value: rv.Material(material)}
	if b := g.BookOf(n, material); b != nil {
		out.Book.Bids = levels(g, b.Bids)
		out.Book.Asks = levels(g, b.Asks)
		out.Book.Last = b.Last
	}
	for _, b := range books {
		bid, ask := b.Best()
		ch, _ := b.Change(moverWindow)
		out.Exchange = append(out.Exchange, api.Exchange{Material: b.Material, Last: b.Last, Change: ch, Bid: bid, Ask: ask, Units: weekUnits(b)})
	}
	for _, mv := range g.Movers(n, moverWindow)[:min(moversShown, len(g.Movers(n, moverWindow)))] {
		out.Movers = append(out.Movers, apiMover(g, mv))
	}
	for _, f := range g.Elsewhere(c, material) {
		out.Elsewhere = append(out.Elsewhere, api.Far{Name: f.Name, Price: f.Price, Age: f.Age, Own: f.Own, Known: f.Known})
	}
	out.Gear = cheapest(g, c, n, gearShown)
	if g.Market != nil {
		for _, wt := range g.Market.Wants {
			if wt.Settlement == n {
				out.Wants = append(out.Wants, apiWant(g, c, wt))
			}
		}
	}
	for _, o := range g.FactionOrders(h) {
		yours, buys := g.PriceFor(c, h, o)
		out.Orders = append(out.Orders, api.Order{Faction: g.FactionName(o.Faction), Material: o.Material, Price: o.Price, Yours: yours, Wanted: o.Qty,
			Refuses: !buys, Fee: rv.FeePercent()})
	}
	out.Mine.Open, out.Mine.Escrow = mine(g, c)
	out.Mine.Gave = g.GaveToday(c)
	if g.Market != nil && len(g.Market.Reports) > 0 {
		r := apiReport(g.Market.Reports[len(g.Market.Reports)-1])
		out.Report = &r
	}
	return out
}

// busiest is the book a character most likely wants: the first good it
// carries that trades here, else the most traded this week.
func busiest(books []*market.Book, c *game.Char) string {
	for _, s := range c.C.Goods {
		if slices.ContainsFunc(books, func(b *market.Book) bool { return b.Material == s.Material }) {
			return s.Material
		}
	}
	best, units := "", int64(-1)
	for _, b := range books {
		if u := weekUnits(b); u > units {
			best, units = b.Material, u
		}
	}
	return best
}

func weekUnits(b *market.Book) int64 {
	n := b.Today.Units
	for _, d := range b.Days[max(0, len(b.Days)-moverWindow):] {
		n += d.Units
	}
	return n
}

// levels are a side's best prices, units at each summed, and whose the
// first order at each is.
func levels(g *game.Game, orders []market.Order) []api.Level {
	out := []api.Level{}
	for _, o := range orders {
		if n := len(out); n > 0 && out[n-1].Price == o.Price {
			out[n-1].Units += o.Qty
			continue
		}
		if len(out) == bookDepth {
			break
		}
		out = append(out, api.Level{Price: o.Price, Units: o.Qty, Who: g.OwnerName(o.Owner)})
	}
	return out
}

func apiMover(g *game.Game, mv game.Mover) api.Mover {
	out := api.Mover{Material: mv.Material, Change: mv.Change, Last: mv.Last}
	if mv.Cause != 0 {
		if i := slices.IndexFunc(g.News, func(n game.News) bool { return n.ID == mv.Cause }); i >= 0 {
			out.Cause = strings.ReplaceAll(g.News[i].Kind, ".", " ") + " near " + g.PlaceName(g.News[i].At)
		}
	}
	return out
}

func apiWant(g *game.Game, c *game.Char, w market.Want) api.GearWant {
	what := w.Slot
	if w.Kind != "" {
		what = g.KindName(w.Kind)
	}
	return api.GearWant{ID: w.ID, What: what, Price: w.Price, Floor: api.Floor{Durability: w.Floor.Durability, Trait: w.Floor.Trait, Level: w.Floor.Level},
		Mine: w.Buyer == ledger.Char(c.C.ID)}
}

// mine is a character's open orders, listings and gear orders, and the
// coin they hold in escrow.
func mine(g *game.Game, c *game.Char) ([]api.Open, int64) {
	out := []api.Open{}
	if g.Market == nil {
		return out, 0
	}
	acc := ledger.Char(c.C.ID)
	t := g.Tick()
	var escrow int64
	where := func(n int) string { return g.PlaceName(g.Rules().Gen.Settlement(n).Hex) }
	for _, b := range g.Market.Books {
		for _, o := range slices.Concat(b.Bids, b.Asks) {
			if o.Owner == acc {
				out = append(out, api.Open{ID: o.ID, Where: where(b.Settlement), What: b.Material, Side: string(o.Side), Price: o.Price, Units: o.Qty, Expires: o.Expires - t})
				if o.Side == market.Bid {
					escrow += g.Ledger.Of(game.EscrowOf(o.ID), ledger.Coin)
				}
			}
		}
	}
	for _, l := range g.Market.Listings {
		if l.Seller == acc {
			out = append(out, api.Open{ID: l.ID, Where: where(l.Settlement), What: g.KindName(l.Item.Kind), Side: "listing", Price: l.Price, Units: 1, Expires: l.Expires - t})
		}
	}
	for _, w := range g.Market.Wants {
		if w.Buyer == acc {
			out = append(out, api.Open{ID: w.ID, Where: where(w.Settlement), What: apiWant(g, c, w).What, Side: "want", Price: w.Price, Units: 1, Expires: w.Expires - t})
			escrow += w.Price
		}
	}
	return out, escrow
}

func apiReport(r game.Report) api.Report {
	out := api.Report{Day: r.Day, Supply: r.Supply, Active: r.Active, PerActive: r.PerActive, Low: r.Low, High: r.High, Rate: r.Rate.Floor(),
		Velocity: r.Velocity.Of(fixed.Hundredths), Faucet: r.Faucet, Fees: r.Fees, Top: []api.Goods{}, Staged: r.Staged, Audit: r.Audit}
	for _, t := range r.Top {
		out.Top = append(out.Top, api.Goods{Material: t.Material, Units: t.Units})
	}
	return out
}

// supplySeries is coin per active character over the weekly reports,
// against the band, under the lock.
func (s *Server) supplySeries() render.Series {
	series := render.Series{Title: "coin per active character", Unit: "coin", Band: [2]int64{s.rules.Faucet.Low, s.rules.Faucet.High}}
	if m := s.g.Market; m != nil {
		for _, r := range m.Reports {
			series.Days = append(series.Days, r.Day)
			series.Values = append(series.Values, r.PerActive)
		}
	}
	return series
}

// history is one material's price over the last days at the settlement a
// character stands in, as a chart with causes marked.
func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	material := r.URL.Query().Get("material")
	var out api.History
	var series render.Series
	var refused error
	if !s.withChar(w, r, func(c *game.Char) {
		g := s.g
		n, ok := g.SettlementAt(c.C.At)
		b := g.BookOf(n, material)
		if !ok || b == nil {
			refused = notHere("nothing called " + material + " trades here")
			return
		}
		name := g.Rules().Name("items.materials:" + material)
		out = api.History{Material: material, Name: name, Days: []api.PricePt{}}
		series = render.Series{Title: name + ", coin each", Unit: "coin"}
		for _, d := range b.Days[max(0, len(b.Days)-historyShown):] {
			pt := api.PricePt{Day: d.Day, Close: d.Close, Units: d.Units}
			if d.Cause != 0 {
				pt.Cause = apiMover(g, game.Mover{Cause: fact.ID(d.Cause)}).Cause
				series.Marks = append(series.Marks, d.Day)
			}
			out.Days = append(out.Days, pt)
			series.Days = append(series.Days, d.Day)
			series.Values = append(series.Values, d.Close)
		}
	}) {
		return
	}
	if refused != nil {
		s.refused(w, refused)
		return
	}
	var err error
	if out.Chart, err = s.picture("history", series, func() (*render.Canvas, error) { return render.Chart(series), nil }); err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

// forum is each open settlement's notable trades and movers of the world
// day before the one asked for (the current day's, for none), for the
// market forum.
func (s *Server) forum(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	out, banners := s.forumPosts()
	unlock()
	for i := range out.Posts {
		var err error
		if out.Posts[i].Banner, err = s.banner(banners[i]); err != nil {
			s.internal(w, err)
			return
		}
	}
	reply(w, http.StatusOK, out)
}

// forumPosts are the posts and their banners' inputs, under the lock.
func (s *Server) forumPosts() (api.Forum, []render.BannerInput) {
	g := s.g
	var banners []render.BannerInput
	out := api.Forum{Day: g.World.Day - 1, Posts: []api.ForumPost{}}
	var trades []game.Trade
	if g.Market != nil {
		trades = g.Market.Yesterday
	}
	for n, h := range g.Settlements() {
		if !g.HasMarket(h) {
			continue
		}
		p := api.ForumPost{Settlement: n, Name: g.PlaceName(h), Trades: []api.Trade{}, Movers: []api.Mover{}}
		banners = append(banners, s.bannerInput(h))
		for _, t := range trades {
			if t.Settlement != n {
				continue
			}
			what := g.Rules().Name("items.materials:" + t.Material)
			if t.Kind != "" {
				what = g.KindName(t.Kind)
			}
			p.Trades = append(p.Trades, api.Trade{What: what, Units: t.Units, Price: t.Price, Coin: t.Coin()})
		}
		movers := g.Movers(n, 1)
		for _, mv := range movers[:min(moversShown, len(movers))] {
			p.Movers = append(p.Movers, apiMover(g, mv))
		}
		out.Posts = append(out.Posts, p)
	}
	return out, banners
}

// routeRisk is the danger of the known route from a character to a tile,
// with what its haul is worth (GDD 10.7).
func (s *Server) routeRisk(w http.ResponseWriter, r *http.Request) {
	to, ok := hexParam(w, r)
	if !ok {
		return
	}
	var out api.RouteRisk
	var refused error
	if !s.withChar(w, r, func(c *game.Char) {
		route, _, ok := s.g.Route(c, to)
		if !ok {
			refused = notHere("no known way to " + to.Ref())
			return
		}
		out = apiRisk(s.g.RouteRisk(c, route))
	}) {
		return
	}
	if refused != nil {
		s.refused(w, refused)
		return
	}
	reply(w, http.StatusOK, out)
}

func apiRisk(rk game.Risk) api.RouteRisk {
	out := api.RouteRisk{Tiles: []api.TileRisk{}, Expected: rk.Expected.Of(fixed.Hundredths), Worst: rk.Worst, Haul: rk.Haul}
	for _, t := range rk.Tiles {
		out.Tiles = append(out.Tiles, api.TileRisk{At: apiHex(t.Hex), Band: t.Band, Chance: t.Chance.Of(fixed.Hundredths)})
	}
	return out
}

// flags lists the characters flagged for an operator's review (GDD
// 10.9), and the faucet's state.
func (s *Server) flags(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	g := s.g
	out := api.Economy{Flagged: []api.Flagged{}, Active: g.Active(), Supply: g.Supply()}
	if m := g.Market; m != nil {
		out.Rate = m.Faucet.Rate.Floor()
		if n := len(m.Faucet.Samples); n > 0 {
			out.PerActive = m.Faucet.Samples[n-1]
		}
	}
	for _, c := range g.Chars {
		if len(c.Review) > 0 {
			out.Flagged = append(out.Flagged, api.Flagged{CharacterID: c.C.ID, Flags: slices.Clone(c.Review), Streak: c.Streak})
		}
	}
	reply(w, http.StatusOK, out)
}

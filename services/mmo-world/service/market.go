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
	if !s.withCharErr(w, r, func(c *game.Char) error {
		g := s.g
		n, ok := g.MarketAt(c.C.At)
		if !ok {
			return notHere("there is no market here")
		}
		out = apiMarket(g, c, n, material)
		banner = s.bannerInput(c.C.At)
		supply = s.supplySeries()
		acc = ledger.Char(c.C.ID)
		return nil
	}) {
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
		goods, ok := ledger.GoodsOf(x.Asset)
		if !ok {
			goods = ""
		}
		out.Mine.Entries = append(out.Mine.Entries, api.Entry{Tick: x.Tick, Kind: x.Kind, Asset: x.Asset, Goods: goods, Units: x.Units})
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
	out.Book = api.BookView{Material: material, Bids: []api.Level{}, Asks: []api.Level{}, Value: rv.Asset(material)}
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
	out.Movers = apiMovers(g, g.Movers(n, moverWindow))
	for _, f := range g.Elsewhere(c, material) {
		out.Elsewhere = append(out.Elsewhere, api.Far{Name: f.Name, Price: f.Price, Age: f.Age, Own: f.Own, Known: f.Known})
	}
	out.Gear = cheapest(g, c, n, gearShown)
	for _, wt := range g.WantsAt(n) {
		out.Wants = append(out.Wants, apiWant(g, c, wt))
	}
	if g.Market != nil {
		if reports := g.Market.Reports; len(reports) > 0 {
			r := apiReport(reports[len(reports)-1], rv.Param("report-days"))
			out.Report = &r
		}
	}
	out.Orders = apiOrders(g, c, h)
	out.Mine.Open, out.Mine.Escrow = mine(g, c)
	out.Mine.Gave = g.GaveToday(c)
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
	units, _ := b.Traded(moverWindow, true)
	return units
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

// apiMovers are the biggest of a settlement's movers, as many as the
// lists show.
func apiMovers(g *game.Game, movers []game.Mover) []api.Mover {
	out := []api.Mover{}
	for _, mv := range movers[:min(moversShown, len(movers))] {
		out = append(out, api.Mover{Material: mv.Material, Change: mv.Change, Last: mv.Last, Cause: causeText(g, mv.Cause)})
	}
	return out
}

// causeText is the news a price move is put down to, or "" when it is
// no longer kept.
func causeText(g *game.Game, id fact.ID) string {
	if id == 0 {
		return ""
	}
	i := slices.IndexFunc(g.News, func(n game.News) bool { return n.ID == id })
	if i < 0 {
		return ""
	}
	return strings.ReplaceAll(g.News[i].Kind, ".", " ") + " near " + g.PlaceName(g.News[i].At)
}

func apiWant(g *game.Game, c *game.Char, w market.Want) api.GearWant {
	return api.GearWant{ID: w.ID, What: g.TradeName("", w.Kind, w.Slot), Price: w.Price, Floor: apiFloor(w.Floor), Mine: w.Buyer == ledger.Char(c.C.ID)}
}

// mine is a character's open orders, listings and gear orders, and the
// coin they hold in escrow.
func mine(g *game.Game, c *game.Char) ([]api.Open, int64) {
	out := []api.Open{}
	t := g.Tick()
	var escrow int64
	for o := range g.Open(ledger.Char(c.C.ID)) {
		out = append(out, api.Open{ID: o.ID, Where: g.PlaceName(g.SettlementHex(o.Settlement)), What: g.TradeName(o.Material, o.ItemKind, o.Slot), Side: o.Kind, Price: o.Price,
			Units: o.Units, Expires: o.Expires - t})
		escrow += o.Escrow
	}
	return out, escrow
}

func apiReport(r game.Report, every int64) api.Report {
	out := api.Report{Day: r.Day, Supply: r.Supply, Active: r.Active, PerActive: r.PerActive, Low: r.Low, High: r.High, Rate: r.Rate.Floor(),
		Velocity: r.Velocity.Of(fixed.Hundredths), Faucet: r.Faucet, Fees: r.Fees, Top: []api.Goods{}, Every: every, Audit: r.Audit}
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
	if !s.withCharErr(w, r, func(c *game.Char) error {
		g := s.g
		n, ok := g.MarketAt(c.C.At)
		b := g.BookOf(n, material)
		if !ok || b == nil {
			return notHere("nothing called " + material + " trades here")
		}
		name := g.MaterialName(material)
		out = api.History{Material: material, Name: name, Days: []api.PricePt{}}
		series = render.Series{Title: name + ", coin each", Unit: "coin"}
		for _, d := range b.Days[max(0, len(b.Days)-historyShown):] {
			pt := api.PricePt{Day: d.Day, Close: d.Close, Units: d.Units}
			if d.Cause != 0 {
				pt.Cause = causeText(g, fact.ID(d.Cause))
				series.Marks = append(series.Marks, d.Day)
			}
			out.Days = append(out.Days, pt)
			series.Days = append(series.Days, d.Day)
			series.Values = append(series.Values, d.Close)
		}
		return nil
	}) {
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
// day just closed, for the market forum.
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
		if _, ok := g.MarketAt(h); !ok {
			continue
		}
		p := api.ForumPost{Settlement: n, Name: g.PlaceName(h), Trades: []api.Trade{}, Movers: []api.Mover{}}
		banners = append(banners, s.bannerInput(h))
		for _, t := range trades {
			if t.Settlement != n {
				continue
			}
			p.Trades = append(p.Trades, api.Trade{What: g.TradeName(t.Material, t.Kind, ""), Units: t.Units, Price: t.Price, Coin: t.Coin()})
		}
		p.Movers = apiMovers(g, g.ClosedMovers(n))
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
	if !s.withCharErr(w, r, func(c *game.Char) error {
		route, _, ok := s.g.Route(c, to)
		if !ok {
			return notHere("no known way to " + to.Ref())
		}
		out = apiRisk(s.g.RouteRisk(c, route), s.g.PlaceName(to))
		return nil
	}) {
		return
	}
	reply(w, http.StatusOK, out)
}

func apiRisk(rk game.Risk, to string) api.RouteRisk {
	out := api.RouteRisk{To: to, Tiles: []api.TileRisk{}, Expected: rk.Expected.Of(fixed.Hundredths), Worst: rk.Worst, Haul: rk.Haul}
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
		out.PerActive = m.Faucet.Mean()
	}
	for _, c := range g.Chars {
		if len(c.Review) > 0 {
			out.Flagged = append(out.Flagged, api.Flagged{CharacterID: c.C.ID, Flags: slices.Clone(c.Review), Streak: c.Streak})
		}
	}
	reply(w, http.StatusOK, out)
}

package service

import (
	"cmp"
	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/world"
	"slices"
)

// structural: what a score part and a region gauge count in.
const (
	unitPts   = "pts"
	unitGauge = "gauge"
)

func apiHex(h hex.Hex) api.Hex { return api.Hex{Q: h.Q, R: h.R} }
func simHex(h api.Hex) hex.Hex { return hex.Hex{Q: h.Q, R: h.R} }

func apiFloor(f market.Floor) api.Floor {
	return api.Floor{Durability: f.Durability, Trait: f.Trait, Level: f.Level}
}

func simFloor(f api.Floor) market.Floor {
	return market.Floor{Durability: f.Durability, Trait: f.Trait, Level: f.Level}
}

func apiParts(ps []game.Part) api.Why {
	out := api.Why{Parts: make([]api.Part, len(ps))}
	for i, p := range ps {
		out.Parts[i] = api.Part{Label: p.Label, Value: p.Value, Unit: p.Unit}
	}
	return out
}

// fightWhy is an option's why with its bands by name: the parts of its
// score, the rules that fired, and the band before and after them.
func fightWhy(g *game.Game, w fight.Why) api.Why {
	out := api.Why{BandFrom: g.BandName(w.BandFrom), BandTo: g.BandName(w.BandTo), Notes: w.Notes}
	for _, p := range w.Parts {
		out.Parts = append(out.Parts, api.Part{Label: p.Label, Value: p.Value, Unit: unitPts})
	}
	for _, s := range w.Rules.Steps {
		out.Rules = append(out.Rules, s.Rule)
	}
	return out
}

// apiOption is an option as a preview shows it: band and risk, never the
// chance behind the band or a roll.
func apiOption(g *game.Game, o fight.Option) api.Option {
	return api.Option{ID: o.ID, Verb: o.Verb, Kind: o.Kind, Band: g.BandName(o.Band), Risk: o.Risk, RiskSize: o.RiskSize,
		Puzzle: o.Puzzle, Why: fightWhy(g, o.Why)}
}

func apiLong(l *game.Long) *api.Long {
	if l == nil {
		return nil
	}
	out := &api.Long{Kind: l.Kind, Due: l.Due, Ends: l.Ends, Material: l.Material, Left: l.Left}
	for _, h := range l.Route {
		out.Route = append(out.Route, apiHex(h))
	}
	return out
}

func apiCharacter(g *game.Game, c *game.Char) api.Character {
	ch := c.C
	out := api.Character{ID: ch.ID, Version: c.Version, At: apiHex(ch.At), Coin: ch.Coin, Provisions: ch.Provisions,
		Goods: apiGoods(ch.Goods), Practice: []api.Skill{}, Long: apiLong(c.Long), InFight: c.Fight != nil,
		Walked: ch.Walked, Banned: c.Banned}
	out.Conditions = conditions(g, c)
	for _, s := range ch.Practice {
		out.Practice = append(out.Practice, api.Skill{ID: s.ID, Level: s.Level})
	}
	if m := ch.In(char.Mount, 0); m != nil {
		out.Mount = &api.Mount{ID: m.ID, Kind: m.Mount, Level: m.Level}
	}
	return out
}

// structural: the listings a purse shows.
const purseListings = 5

// cheapest are a settlement's cheapest gear listings, as a character
// sees them.
func cheapest(g *game.Game, c *game.Char, n, most int) []api.Listing {
	ls := g.ListingsAt(n)
	slices.SortStableFunc(ls, func(a, b market.Listing) int { return cmp.Compare(a.Price, b.Price) })
	out := []api.Listing{}
	for _, l := range ls[:min(len(ls), most)] {
		out = append(out, apiListing(g, c, l))
	}
	return out
}

func apiListing(g *game.Game, c *game.Char, l market.Listing) api.Listing {
	in := l.Item
	out := api.Listing{ID: l.ID, Kind: in.Kind, Name: g.KindName(in.Kind), Level: in.Level, Picks: int64(len(in.Picks)), Durability: in.Durability,
		Max: in.MaxDurability, Maker: in.Maker, Seller: g.OwnerName(l.Seller), Price: l.Price, Value: g.ItemValue(in), Mine: l.Seller == ledger.Char(c.C.ID)}
	if k, ok := g.Kinds.Kind(in.Kind); ok {
		out.Slot = k.Slot
	}
	return out
}

func apiGoods(goods []item.Spoil) []api.Goods {
	out := make([]api.Goods, 0, len(goods))
	for _, s := range goods {
		out = append(out, api.Goods{Material: s.Material, Units: s.Qty})
	}
	return out
}

func conditions(g *game.Game, c *game.Char) []string {
	out := []string{}
	for _, t := range c.C.ConditionTags(g.Tick()) {
		out = append(out, string(t))
	}
	return out
}

func apiOptions(g *game.Game, c *game.Char) api.Options {
	ch := g.Choose(c)
	out := api.Options{CharacterID: c.C.ID, Version: c.Version, Tick: g.Tick(), At: apiHex(c.C.At), Conditions: conditions(g, c),
		Moves: []api.Move{}, Materials: ch.Materials,
		GatherMin: ch.GatherMin, GatherMax: ch.GatherMax, Rest: ch.Rest, Explore: ch.Explore, Cancel: ch.CanCancel, Long: apiLong(ch.Long)}
	if out.Materials == nil {
		out.Materials = []string{}
	}
	if called := g.Called(c); called || c.Carrying != "" || c.CarriedBy != "" {
		out.Rescue = &api.Rescue{Called: called, Home: g.PlaceName(g.SettlementHex(g.HomeOf(c))), Carrying: c.Carrying, CarriedBy: c.CarriedBy}
		if d := g.Char(c.Carrying); d != nil {
			out.Rescue.CarryingHome = g.PlaceName(g.SettlementHex(g.HomeOf(d)))
		}
	}
	for _, m := range ch.Moves {
		out.Moves = append(out.Moves, api.Move{Dir: m.Dir, To: apiHex(m.To), Open: m.Open, Ticks: m.Ticks, Why: apiParts(m.Why)})
	}
	if f := ch.Fight; f != nil {
		v := &api.Fight{ID: f.ID, Beat: f.Beat, Beats: f.Beats, Kind: f.Kind, Creature: f.Creature, Ambush: f.Ambush,
			Default: f.Default, Due: f.Due, Options: []api.Option{}}
		for _, o := range f.Options {
			v.Options = append(v.Options, apiOption(g, o))
		}
		out.Fight = v
	}
	out.Purse = apiPurse(g, c)
	return out
}

func apiPurse(g *game.Game, c *game.Char) api.Purse {
	p := api.Purse{Coin: c.C.Coin, Provisions: c.C.Provisions, Goods: apiGoods(c.C.Goods), Load: api.Load{Carried: c.Carried(), Capacity: g.Capacity(c)},
		Open: g.OpenOrders(c), Markets: []api.Hex{}}
	worn := func(in *item.Instance) api.Worn {
		w := api.Worn{ID: in.ID, Kind: in.Kind, Durability: in.Durability, Max: in.MaxDurability, Value: g.ItemValue(in)}
		if k, ok := g.Kinds.Kind(in.Kind); ok {
			cost := g.RepairCost(in, k)
			w.Repair = api.Goods{Material: cost.Material, Units: cost.Units}
		}
		return w
	}
	if in := c.C.In(char.Hand, 0); in != nil {
		w := worn(in)
		p.Hand = &w
	}
	p.Items = []api.Worn{}
	for _, in := range c.C.Pack {
		if !c.C.Worn(in.ID) {
			p.Items = append(p.Items, worn(in))
		}
	}
	p.Mounted, p.Owed = c.C.In(char.Mount, 0) != nil, c.Owed
	for _, h := range g.Settlements() {
		p.Markets = append(p.Markets, apiHex(h))
	}
	n, ok := g.MarketAt(c.C.At)
	if !ok {
		return p
	}
	p.Market = true
	rv := g.Rules().Values
	for _, o := range g.Offers(c.C.At) {
		if o.Asset == ledger.Provisions {
			p.Provision = o.Price
		} else {
			p.Mounts = append(p.Mounts, api.Offer{Asset: o.Asset, Price: o.Price})
		}
	}
	p.Listings = cheapest(g, c, n, purseListings)
	for _, b := range g.BooksAt(n) {
		bid, ask := b.Best()
		q := api.Quote{Material: b.Material, Bid: bid, Ask: ask, Value: rv.Asset(b.Material)}
		if len(b.Bids) > 0 {
			q.BidUnits = b.Bids[0].Qty
		}
		p.Quotes = append(p.Quotes, q)
	}
	return p
}

func apiFacts(fs []fact.Fact) []api.Fact {
	out := make([]api.Fact, len(fs))
	for i, f := range fs {
		x := api.Fact{ID: int64(f.ID), Tick: f.Tick, Kind: f.Kind, Region: f.Region, Weight: f.Weight,
			Subjects: make([]api.Ref, len(f.Subjects)), Data: make([]api.Datum, len(f.Data))}
		for j, s := range f.Subjects {
			x.Subjects[j] = api.Ref{Kind: s.Kind, ID: s.ID}
		}
		for j, d := range f.Data {
			x.Data[j] = api.Datum{Key: d.Key, N: d.N, S: d.S}
		}
		out[i] = x
	}
	return out
}

func apiPressed(g *game.Game, ps []fight.Pressed) []api.Pressed {
	var out []api.Pressed
	for _, p := range ps {
		out = append(out, api.Pressed{Option: p.Option.ID, Band: g.BandName(p.Option.Band), Success: p.Outcome.Success, Why: fightWhy(g, p.Why)})
	}
	return out
}

// apiTile is a discovered tile: what it is, and what stands and blows on
// it now.
func apiTile(g *game.Game, h hex.Hex) (api.Tile, bool) {
	st := g.World.Tile(h)
	if st == nil || st.Discovered == nil {
		return api.Tile{}, false
	}
	return tileView(g, h), true
}

// tileView is a tile as a client sees it, found or not: only for a tile
// the asking character stands on.
func tileView(g *game.Game, h hex.Hex) api.Tile {
	b := g.Rules().Gen.Baseline(h)
	out := api.Tile{Hex: apiHex(h), Terrain: b.Terrain, Water: b.Water, Site: g.SiteAt(h), Landmark: b.Landmark}
	if st := g.World.Tile(h); st != nil {
		out.Road = st.Road
		if st.Discovered != nil {
			out.Found = st.Discovered.Tick
		}
		for _, s := range st.Structures {
			out.Structures = append(out.Structures, s.Kind)
		}
	}
	if r := g.World.RegionAt(h); r >= 0 {
		out.Region = world.RegionRef(r)
	}
	if w, ok := g.World.Weather(h); ok {
		out.Weather = w.Kind
	}
	return out
}

// apiPlace is a discovered tile with its region's gauges and holder and who
// stands there; ok is false for a tile nobody has found.
func apiPlace(g *game.Game, h hex.Hex) (api.Place, bool) {
	if _, ok := apiTile(g, h); !ok {
		return api.Place{}, false
	}
	return placeView(g, h), true
}

// placeView is a place found or not: only for where the asking character
// stands.
func placeView(g *game.Game, h hex.Hex) api.Place {
	t := tileView(g, h)
	out := api.Place{Tick: g.Tick(), Tile: t, Gauges: []api.Gauge{}, Here: []string{}, Rest: g.CanRest(h), Explore: g.CanExplore(h), Overrun: g.World.Past(h, "overrun")}
	if gauges, holder, ok := g.RegionGauges(h); ok {
		for _, m := range gauges {
			out.Gauges = append(out.Gauges, api.Gauge{ID: m.ID, Value: m.Value, Unit: unitGauge})
		}
		if holder >= 0 {
			out.Holder = world.FactionRef(holder)
		}
	}
	for _, c := range g.Chars {
		if c.C.At == h {
			out.Here = append(out.Here, c.C.ID)
		}
	}
	return out
}

// apiOrders are the faction orders standing on a tile, priced for a
// character.
func apiOrders(g *game.Game, c *game.Char, h hex.Hex) []api.Order {
	fee := g.Rules().Values.FeePercent()
	out := []api.Order{}
	for _, o := range g.FactionOrders(h) {
		yours, buys := g.PriceFor(c, h, o)
		out = append(out, api.Order{Faction: g.FactionName(o.Faction), Material: o.Material, Price: o.Price, Yours: yours, Wanted: o.Qty, Refuses: !buys,
			Fee: fee})
	}
	return out
}

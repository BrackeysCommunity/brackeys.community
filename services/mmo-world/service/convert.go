package service

import (
	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/world"
)

// structural: what a score part and a region gauge count in.
const (
	unitPts   = "pts"
	unitGauge = "gauge"
)

func apiHex(h hex.Hex) api.Hex { return api.Hex{Q: h.Q, R: h.R} }
func simHex(h api.Hex) hex.Hex { return hex.Hex{Q: h.Q, R: h.R} }

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
		Goods: []api.Goods{}, Practice: []api.Skill{}, Long: apiLong(c.Long), InFight: c.Fight != nil,
		Walked: ch.Walked, Banned: c.Banned}
	for _, s := range ch.Goods {
		out.Goods = append(out.Goods, api.Goods{Material: s.Material, Units: s.Qty})
	}
	out.Conditions = conditions(g, c)
	for _, s := range ch.Practice {
		out.Practice = append(out.Practice, api.Skill{ID: s.ID, Level: s.Level})
	}
	if m := ch.In(char.Mount, 0); m != nil {
		out.Mount = &api.Mount{ID: m.ID, Kind: m.Mount, Level: m.Level}
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
	return out
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
	b := g.Rules().Gen.Baseline(h)
	out := api.Tile{Hex: apiHex(h), Terrain: b.Terrain, Water: b.Water, Site: b.Site, Landmark: b.Landmark, Road: st.Road,
		Found: st.Discovered.Tick}
	if r := g.World.RegionAt(h); r >= 0 {
		out.Region = world.RegionRef(r)
	}
	for _, s := range st.Structures {
		out.Structures = append(out.Structures, s.Kind)
	}
	if w, ok := g.World.Weather(h); ok {
		out.Weather = w.Kind
	}
	return out, true
}

// apiPlace is a discovered tile with its region's gauges and holder and who
// stands there; ok is false for a tile nobody has found.
func apiPlace(g *game.Game, h hex.Hex) (api.Place, bool) {
	t, ok := apiTile(g, h)
	if !ok {
		return api.Place{}, false
	}
	out := api.Place{Tick: g.Tick(), Tile: t, Gauges: []api.Gauge{}, Here: []string{}, Rest: g.CanRest(h), Explore: g.CanExplore(h)}
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
	return out, true
}

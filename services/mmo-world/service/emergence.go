package service

import (
	"cmp"
	"net/http"
	"slices"
	"strconv"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// structural: a sheet material's pack-key prefix, and the separator in a
// caravan's id (its route's and its departure day).
const (
	sheetMaterial = "items.materials:"
	caravanSep    = "@"
)

// apiPromotion is a promotion as anyone may read it: never its first.
func apiPromotion(g *game.Game, p *emerge.Promotion) api.Promotion {
	out := api.Promotion{ID: p.ID, Type: string(p.Type), Name: p.Shown(), Places: p.Places, Of: p.Of, Day: p.Tick / sheets.TicksPerDay}
	if p.Region >= 0 {
		out.Region = world.RegionRef(p.Region)
	}
	if p.At != nil {
		h := apiHex(*p.At)
		out.At = &h
	}
	r := g.Rules()
	e := g.Emergence
	switch p.Type {
	case emerge.Style:
		if st := e.Styles[emerge.StyleKey{Region: p.Region, Style: p.Of}]; st != nil {
			out.Resists = st.Resisted
		}
		key, pairing := r.Emerge.Styles.Keystone(p.Of)
		if pairing {
			out.OfName = r.Name("items.pairings:" + p.Of)
		} else {
			out.OfName = r.Name("items.traits:" + key)
		}
	case emerge.Variant:
		out.OfName = r.Name("creatures.archetypes:" + p.Of)
		for _, v := range e.Variants {
			if v.ID == p.ID {
				out.Resists, out.Material = v.Resisted, v.Material
			}
		}
	case emerge.Material:
		if base, ok := foundBase(p.Of); ok {
			out.OfName = r.Name(sheetMaterial + base)
		}
		out.Material = p.Of
	case emerge.Legend:
		out.OfName = legendOfName(g, p)
	case emerge.Class:
		out.OfName = cmp.Or(r.Name("classes.classes:"+p.Of), titleOf(p.Of))
	case emerge.Masters:
		out.OfName = familyName(g, p.Of)
	case emerge.Camp, emerge.Haunt:
		out.OfName = r.Name("map.site-kinds:" + p.Of)
	case emerge.Road, emerge.Route, emerge.Custom:
		// Named by their places alone.
	}
	return out
}

// foundBase is the sheet material a found material was made from.
func foundBase(id string) (string, bool) {
	_, base, ok := emerge.ParseMaterialID(id)
	return base, ok
}

// legendOfName is what a legend was made of: its creature's name, or the
// kind of the item its holder carries.
func legendOfName(g *game.Game, p *emerge.Promotion) string {
	rec := g.Emergence.Legend(p.ID)
	if rec == nil {
		return ""
	}
	of := rec.Of
	switch of.Kind {
	case game.LegendCreature:
		return g.Rules().Name("creatures.archetypes:" + of.ID)
	case game.LegendItem:
		if c := g.Char(p.First); c != nil {
			if in := c.C.Item(of.ID); in != nil {
				return g.KindName(in.Kind)
			}
		}
	}
	return ""
}

// promotionOf is the promotion a fact names, from its record as the game
// holds it now.
func promotionOf(g *game.Game, f fact.Fact) *api.Promotion {
	if g.Emergence == nil {
		return nil
	}
	for _, s := range f.Subjects {
		if s.Kind != game.RefPromotion {
			continue
		}
		if p := g.Emergence.Promotion(s.ID); p != nil {
			out := apiPromotion(g, p)
			return &out
		}
	}
	return nil
}

// emergentTile adds what emergence made of a tile: its road, a cut or a
// toll on it today, a camp and a haunt.
func emergentTile(g *game.Game, h hex.Hex, out *api.Tile) {
	e := g.Emergence
	if e == nil {
		return
	}
	out.RoadName, out.Cut, out.Toll = g.RoadState(h)
	if c := e.Camps[h]; c != nil {
		out.Camp = e.Shown(c.ID)
	}
	out.Haunted = e.Haunts[h] != nil
}

// variantSeen is the name and row of the region's variant an overland
// encounter is, or "" for any other creature.
func variantSeen(g *game.Game, h hex.Hex, e *fight.Encounter) (string, string) {
	if g.Emergence == nil || e.Floor != 0 {
		return "", ""
	}
	v, ok := g.VariantAt(h, e.Creature)
	if !ok {
		return "", ""
	}
	return g.Emergence.Shown(v.ID), v.Row
}

// renamable is the id of the promotion a fact announces when the viewer is
// its first and may still name it.
func renamable(g *game.Game, viewer string, f fact.Fact) string {
	if g.Emergence == nil || f.Kind != game.FactPromotion {
		return ""
	}
	d, ok := f.Get("id")
	if !ok {
		return ""
	}
	p, err := g.CanRename(d.S, viewer)
	if err != nil {
		return ""
	}
	return p.ID
}

// foundNames are the names of the found materials among ids, keyed as the
// pack keys a sheet material; nil when none is found.
func foundNames(g *game.Game, ids []string) map[string]string {
	e := g.Emergence
	if e == nil || len(e.Materials) == 0 {
		return nil
	}
	var out map[string]string
	for _, id := range ids {
		for _, m := range e.Materials {
			if m.ID == id {
				if out == nil {
					out = map[string]string{}
				}
				out[sheetMaterial+id] = g.MaterialName(id)
				break
			}
		}
	}
	return out
}

// materialNames are every found material's name, keyed as the pack keys a
// sheet material.
func materialNames(g *game.Game) map[string]string {
	out := map[string]string{}
	if g.Emergence == nil {
		return out
	}
	for _, m := range g.Emergence.Materials {
		out[sheetMaterial+m.ID] = g.MaterialName(m.ID)
	}
	return out
}

// stateNames names the found materials an Activity state shows.
func stateNames(g *game.Game, st *api.ActivityState) map[string]string {
	if g.Emergence == nil || len(g.Emergence.Materials) == 0 {
		return nil
	}
	var ids []string
	add := func(gs []api.Goods) {
		for _, x := range gs {
			ids = append(ids, x.Material)
		}
	}
	add(st.Character.Goods)
	for _, p := range st.Pouches {
		add(p.Goods)
	}
	if st.Floor != nil {
		add(st.Floor.Pool)
	}
	if st.Hunt != nil {
		add(st.Hunt.Spoils)
	}
	return foundNames(g, ids)
}

// promotionKinds are what the chronicle channel posts as it happens: the
// game's chronicle kinds and a rules epoch with its notes.
var promotionKinds = append(slices.Clone(game.ChronicleKinds), game.FactSeasonEpoch)

// storyPromotions are the chronicle channel's promotions after a fact id,
// each with its record as the game holds it now, masked for the server named,
// capped like the events. A rules epoch carries its stored notes.
func (s *Server) storyPromotions(w http.ResponseWriter, r *http.Request) {
	var after int64
	if q := r.URL.Query().Get("after"); q != "" {
		n, err := strconv.ParseInt(q, 10, 64)
		if err != nil || n < 0 {
			refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "after is a fact id"})
			return
		}
		after = n
	}
	facts, err := s.st.StoryFactsSince(r.Context(), promotionKinds, fact.ID(after), eventsMost)
	if err != nil {
		s.internal(w, err)
		return
	}
	notes := map[int64]*api.EpochNotes{}
	for _, f := range facts {
		d, ok := f.Get("season")
		if f.Kind != game.FactSeasonEpoch || !ok {
			continue
		}
		if _, done := notes[d.N]; done {
			continue
		}
		n, found, err := s.st.EpochNotes(r.Context(), d.N)
		if err != nil {
			s.internal(w, err)
			return
		}
		notes[d.N] = nil
		if found {
			notes[d.N] = &n
		}
	}
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	server := r.URL.Query().Get("server")
	out := api.StoryEvents{Events: []api.StoryEvent{}, Last: after}
	for _, f := range facts {
		out.Last = max(out.Last, int64(f.ID))
		ev, ok := storyEvent(s.g, f, server)
		if !ok {
			continue
		}
		if d, on := f.Get("season"); f.Kind == game.FactSeasonEpoch && on {
			ev.Epoch = notes[d.N]
		}
		out.Events = append(out.Events, ev)
	}
	reply(w, http.StatusOK, out)
}

// operatorEmergence is the operator's dashboard of the four measures,
// read under the lock.
func (s *Server) operatorEmergence(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	d, on := s.g.Measures()
	if !on {
		refuse(w, http.StatusNotFound, api.Refusal{Code: api.CodeNotFound, Message: "the world keeps no emergence"})
		return
	}
	reply(w, http.StatusOK, apiEmergence(s.g, d))
}

// apiEmergence is the dashboard on the wire.
func apiEmergence(g *game.Game, d game.Dashboard) api.Emergence {
	out := api.Emergence{Day: d.Day, Season: d.Season, Active: d.Active, KindsPerMille: append([]int64{}, d.KindsPerMille...), KindsHealthy: d.KindsHealthy,
		Promotions: typeCounts(d.Promotions), Need: d.Need, PromotionsHealthy: d.PromotionsHealthy, Heavy: d.Heavy, HeavyPlayer: d.HeavyPlayer,
		HeavyHealthy: d.HeavyHealthy, Pairing: []api.RegionShare{}, PairingHealthy: d.PairingHealthy, Traces: typeCounts(d.Traces), Recent: []api.Promotion{}}
	for _, p := range d.Pairing {
		region := ""
		if p.Region >= 0 {
			region = world.RegionRef(p.Region)
		}
		out.Pairing = append(out.Pairing, api.RegionShare{Region: region, Style: p.Style, Name: p.Name, Percent: p.Percent})
	}
	for i := range d.Recent {
		out.Recent = append(out.Recent, apiPromotion(g, &d.Recent[i]))
	}
	return out
}

func typeCounts(ts []game.TypeCount) []api.TypeCount {
	out := make([]api.TypeCount, 0, len(ts))
	for _, t := range ts {
		out = append(out, api.TypeCount{Type: t.Type, Count: t.Count})
	}
	return out
}

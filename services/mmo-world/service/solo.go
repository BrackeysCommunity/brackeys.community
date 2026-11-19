package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// structural: the map crop's default and widest radius, in tiles; recent
// facts a place shows; ticks an hour; pictures the media cache keeps.
const (
	mapRadius    = 4
	mapRadiusMax = 6
	recentFacts  = 5
	ticksPerHour = 6
	mediaKept    = 1024
)

func simRecipe(r api.Recipe) item.Recipe {
	out := item.Recipe{Process: r.Process, Method: r.Method, Slot: r.Slot}
	for _, in := range r.Inputs {
		out.Inputs = append(out.Inputs, item.Input{Kind: in.Material, Qty: in.Units})
	}
	return out
}

func apiRecipe(r item.Recipe) api.Recipe {
	out := api.Recipe{Process: r.Process, Method: r.Method, Slot: r.Slot, Inputs: []api.Goods{}}
	for _, in := range r.Inputs {
		out.Inputs = append(out.Inputs, api.Goods{Material: in.Kind, Units: in.Qty})
	}
	return out
}

// media keeps rendered pictures by key, oldest dropped first.
type media struct {
	mu    sync.Mutex
	png   map[string][]byte
	order []string
}

func (m *media) put(key string, draw func() ([]byte, error)) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.png == nil {
		m.png = map[string][]byte{}
	}
	if _, ok := m.png[key]; ok {
		return key, nil
	}
	b, err := draw()
	if err != nil {
		return "", err
	}
	m.png[key] = b
	m.order = append(m.order, key)
	if len(m.order) > mediaKept {
		delete(m.png, m.order[0])
		m.order = m.order[1:]
	}
	return key, nil
}

func (m *media) get(key string) ([]byte, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.png[key]
	return b, ok
}

// picture renders a picture under the key of its input, once.
func (s *Server) picture(kind string, input any, draw func() (*render.Canvas, error)) (string, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	return s.media.put(render.Key(kind, body), func() ([]byte, error) {
		c, err := draw()
		if err != nil {
			return nil, err
		}
		return c.PNG()
	})
}

func (s *Server) mediaHandler(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimSuffix(r.PathValue("key"), ".png")
	b, ok := s.media.get(key)
	if !ok {
		refuse(w, http.StatusNotFound, api.Refusal{Code: api.CodeNotFound, Message: "no picture " + key})
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(b)
}

// withChar runs a read for the character a query names, under the lock.
func (s *Server) withChar(w http.ResponseWriter, r *http.Request, f func(c *game.Char)) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	if c := s.charFor(w, r.URL.Query().Get("characterId")); c != nil {
		f(c)
	}
}

func (s *Server) sheet(w http.ResponseWriter, r *http.Request) {
	s.withChar(w, r, func(c *game.Char) {
		out, err := s.apiSheet(c)
		if err != nil {
			s.internal(w, err)
			return
		}
		reply(w, http.StatusOK, out)
	})
}

func (s *Server) apiSheet(c *game.Char) (api.Sheet, error) {
	g := s.g
	out := api.Sheet{Character: apiCharacter(g, c), Start: c.Start, Kit: []api.Item{}, Pack: []api.Item{}, Standing: []api.Standing{},
		Record: []api.Count{}, Finds: []api.Find{}, Owed: c.Owed, Load: api.Load{Carried: c.Carried(), Capacity: g.Capacity(c)},
		Consent: api.Consent{SameServer: !c.HideSame, OtherServers: c.NameOther}}
	worn := map[string]string{}
	for _, e := range c.C.Equipped {
		worn[e.Item] = e.Slot
	}
	for _, in := range c.C.Pack {
		it, err := s.apiItem(in, worn[in.ID])
		if err != nil {
			return out, err
		}
		if it.Worn != "" {
			out.Kit = append(out.Kit, it)
		} else {
			out.Pack = append(out.Pack, it)
		}
	}
	for _, x := range c.C.Standing {
		out.Standing = append(out.Standing, api.Standing{With: x.Key, Value: x.N})
	}
	f := c.C.Fights
	out.Record = append(out.Record,
		api.Count{Key: "walked", N: c.C.Walked, Unit: "tiles"}, api.Count{Key: "downs", N: f.Downs, Unit: "times"},
		api.Count{Key: "discoveries", N: c.C.Discoveries, Unit: "kinds"}, api.Count{Key: "encounters", N: c.Encounters, Unit: "encounters"})
	for _, x := range f.Won {
		out.Record = append(out.Record, api.Count{Key: "won:" + x.Key, N: x.N, Unit: "beats"})
	}
	for _, x := range c.C.Earned {
		out.Record = append(out.Record, api.Count{Key: "earned:" + x.Key, N: x.N, Unit: "coin"})
	}
	if n := f.Nemesis(); n != "" {
		out.Record = append(out.Record, api.Count{Key: "nemesis:" + n, N: f.DownedBy.Get(n), Unit: "downs"})
	}
	for _, x := range c.Finds {
		out.Finds = append(out.Finds, apiFind(x))
	}
	return out, nil
}

func apiFind(f game.Find) api.Find {
	out := api.Find{Trigger: f.Trigger, Rarity: f.Rarity, Chance: f.Chance.Of(fixed.Hundredths), Item: f.Item}
	for _, x := range f.Goods {
		out.Goods = append(out.Goods, api.Goods{Material: x.Material, Units: x.Qty})
	}
	return out
}

// apiItem is an item's card, with its sigil drawn.
func (s *Server) apiItem(in *item.Instance, worn string) (api.Item, error) {
	g := s.g
	r := g.Rules()
	out := api.Item{ID: in.ID, Kind: in.Kind, Worn: worn, Level: in.Level, XP: in.XP, Durability: in.Durability, Max: in.MaxDurability,
		Dormant: in.Dormant, Axes: []api.Part{}, Traits: []string{}, Picks: append([]string{}, in.Picks...), Offers: in.Offers, Maker: in.Maker, Mount: in.Mount}
	if in.Mount != "" {
		out.Name, out.Slot = r.Name("mounts.kinds:"+in.Mount), char.Mount
		if m := r.Mounts.Kind(in.Mount); m != nil {
			out.Tier = m.Tier
		}
	}
	k, ok := g.Kinds.Kind(in.Kind)
	if ok {
		out.Name, out.Slot, out.Tier, out.Value = g.Kinds.Name(k.ID), k.Slot, k.Tier, r.Values.Kind(&g.Kinds, k)
		out.ToNext = r.Growth.ToNext(in.Level)
		axes := r.Fight.D.Axes()
		for i, v := range k.Vec {
			if v > 0 {
				out.Axes = append(out.Axes, api.Part{Label: axes[i], Value: r.Growth.Stat(v, k.Tier, in.Level), Unit: "pts"})
			}
		}
		out.Traits = append(out.Traits, in.Traits(k, r.Fight.D)...)
		top := topTwo(k.Vec)
		sig := render.SigilInput{Process: k.Recipe.Process, Slot: k.Slot, Axes: top, Level: in.Level, Picks: len(in.Picks), Maker: in.Maker, Dormant: in.Dormant}
		key, err := s.picture("sigil", sig, func() (*render.Canvas, error) { return render.Sigil(sig), nil })
		if err != nil {
			return out, err
		}
		out.Sigil = key
	}
	if in.Exploit != nil {
		x, err := s.apiItem(in.Exploit, "")
		if err != nil {
			return out, err
		}
		out.Exploit = &x
	}
	return out, nil
}

func topTwo(v item.Vec) [2]int {
	a, b := 0, 1
	for i, x := range v {
		if x > v[a] {
			a, b = i, a
		} else if i != a && x > v[b] {
			b = i
		}
	}
	return [2]int{a, b}
}

func (s *Server) here(w http.ResponseWriter, r *http.Request) {
	s.withChar(w, r, func(c *game.Char) {
		out, err := s.apiHere(r, c)
		if err != nil {
			s.internal(w, err)
			return
		}
		reply(w, http.StatusOK, out)
	})
}

func (s *Server) apiHere(r *http.Request, c *game.Char) (api.Here, error) {
	g := s.g
	h := c.C.At
	place := placeView(g, h)
	out := api.Here{Place: place, Name: g.PlaceName(h), Stations: []api.Station{}, Orders: []api.Order{}, Offers: []api.Offer{},
		People: []api.Person{}, Trails: []api.Trail{}, Search: g.CanSearch(c, h), Materials: []api.Stock{}, Forage: g.ForageYield(h), Recent: []api.Fact{}}
	rv := g.Rules().Values
	for _, st := range g.Stations(h) {
		out.Stations = append(out.Stations, api.Station{Kind: st.Kind, Tier: st.Tier, Fee: st.Tier * rv.Param("station-fee")})
	}
	for _, o := range g.Orders(h) {
		out.Orders = append(out.Orders, api.Order{Faction: g.FactionName(o.Faction), Material: o.Material, Price: o.Price, Fee: rv.Param("fill-fee")})
	}
	if g.HasStructure(h, "market") {
		out.Offers = append(out.Offers, api.Offer{Asset: "provisions", Price: rv.Param("provisions-price")})
	}
	if g.HasStructure(h, "stable") {
		for _, m := range g.Rules().Book.MountKinds {
			if m.Tier == g.Rules().Book.Tiers[0].Tier {
				out.Offers = append(out.Offers, api.Offer{Asset: m.ID, Price: m.Tier * rv.Param("mount-price")})
			}
		}
	}
	for _, p := range g.PeopleHere(c, h) {
		out.People = append(out.People, apiPerson(g, p))
	}
	for _, t := range g.Trails(c, h) {
		out.Trails = append(out.Trails, api.Trail{Who: t.Who, Ticks: g.Tick() - t.Tick, Now: apiHex(t.Now)})
	}
	if g.IsDungeon(h) {
		out.Dungeon = "open"
		if g.FloorCleared(h) {
			out.Dungeon = "cleared"
		}
	}
	for _, m := range g.Materials(h) {
		out.Materials = append(out.Materials, api.Stock{Material: m, Left: g.StockLeft(h, m), WorkedOut: g.WorkedOut(h, m)})
	}
	if sg, ok := g.Suggest(h); ok {
		out.Suggest = &api.Suggest{At: apiHex(sg.At), Tiles: sg.Tiles, Dir: sg.Dir}
	}
	if place.Tile.Region != "" {
		recent, err := s.st.RecentIn(r.Context(), place.Tile.Region, recentFacts)
		if err != nil {
			return out, err
		}
		out.Recent = apiFacts(recent)
	}
	key, err := s.banner(h)
	out.Banner = key
	return out, err
}

func apiPerson(g *game.Game, p game.Person) api.Person {
	role := p.Role
	if row := g.Rules().NPC.Role(p.Role); row != nil {
		role = row.Role
	}
	return api.Person{ID: p.ID, Name: p.Name, Role: role, Kind: p.Kind, Traits: p.Traits, Saved: p.Saved, Visit: p.Visit}
}

// banner draws the banner of the region a tile is in, as it stands now.
func (s *Server) banner(h hex.Hex) (string, error) {
	g := s.g
	r := g.Rules()
	b := r.Gen.Baseline(h)
	in := render.BannerInput{Terrain: b.Terrain, Hour: (g.Tick() % sheets.TicksPerDay) / ticksPerHour, Settlement: b.Site == gen.PlaceSettlement}
	if ri := g.World.RegionAt(h); ri >= 0 {
		reg := g.World.Regions[ri]
		in.Seed = world.RegionRef(ri)
		in.Threat = reg.Gauge[g.World.GaugeIndex("threat")]
		in.Corruption = reg.Gauge[g.World.GaugeIndex("corruption")]
		in.Danger = in.Threat >= world.LineAt(r.Book, "ambush")
		in.Overrun = in.Threat >= world.LineAt(r.Book, "overrun")
		in.Corrupted = in.Corruption >= world.LineAt(r.Book, "corrupted-nodes")
		if reg.Holder >= 0 {
			for _, a := range r.Book.Archetypes {
				if a.ID == g.World.Factions[reg.Holder].Archetype {
					in.Tags = a.Tags
				}
			}
		}
	}
	if w, ok := g.World.Weather(h); ok {
		in.Weather = w.Kind
	}
	return s.picture("banner", in, func() (*render.Canvas, error) { return render.Banner(in, r.Book.BannerLayers, r.Book.Palette) })
}

func (s *Server) appraise(w http.ResponseWriter, r *http.Request) {
	var req api.AppraiseRequest
	if !decode(w, r, &req) {
		return
	}
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	c := s.charFor(w, req.CharacterID)
	if c == nil {
		return
	}
	ap, err := s.g.Appraise(c, simRecipe(req.Recipe))
	if err != nil {
		s.refused(w, err)
		return
	}
	axes := s.g.Rules().Fight.D.Axes()
	out := api.Appraisal{Kind: ap.Ranges.Kind, Name: ap.Name, Tier: ap.Ranges.Tier, Slot: ap.Ranges.Slot, Known: ap.Ranges.Known,
		Axes: []api.Range{}, Station: api.Station{Kind: ap.Station.Kind, Tier: ap.Station.Tier, Fee: ap.Fee}, Inputs: req.Recipe.Inputs}
	for i := range ap.Ranges.Lo {
		if ap.Ranges.Hi[i] > 0 {
			out.Axes = append(out.Axes, api.Range{Axis: axes[i], Lo: ap.Ranges.Lo[i], Hi: ap.Ranges.Hi[i]})
		}
	}
	reply(w, http.StatusOK, out)
}

// refused answers a read the rules turned down.
func (s *Server) refused(w http.ResponseWriter, err error) {
	var ref *game.Refused
	if errors.As(err, &ref) {
		refuse(w, http.StatusUnprocessableEntity, *apiRefusal(ref))
		return
	}
	s.internal(w, err)
}

func (s *Server) recipes(w http.ResponseWriter, r *http.Request) {
	s.withChar(w, r, func(c *game.Char) {
		b := s.g.Rules().Book
		out := api.Recipes{Processes: []api.Process{}, Slots: []string{}, Known: []api.Known{}}
		for _, p := range b.Processes {
			x := api.Process{ID: p.ID, Stations: p.Stations, Methods: []string{}}
			for _, m := range b.Methods {
				if m.Process == p.ID {
					x.Methods = append(x.Methods, m.ID)
				}
			}
			out.Processes = append(out.Processes, x)
		}
		for _, sl := range b.Slots {
			out.Slots = append(out.Slots, sl.ID)
		}
		seen := map[string]bool{}
		add := func(id string, first bool) {
			if k, ok := s.g.Kinds.Kind(id); ok && !seen[id] {
				seen[id] = true
				out.Known = append(out.Known, api.Known{Kind: id, Name: s.g.Kinds.Name(id), Recipe: apiRecipe(k.Recipe), First: first})
			}
		}
		for _, id := range c.C.Discovered {
			add(id, true)
		}
		for _, in := range c.C.Pack {
			add(in.Kind, false)
		}
		reply(w, http.StatusOK, out)
	})
}

func (s *Server) recap(w http.ResponseWriter, r *http.Request) {
	s.withChar(w, r, func(c *game.Char) {
		since := max(c.Seen, s.g.Tick()-s.g.RecapWindow())
		view := *c
		view.Seen = since
		own, heavy, err := s.st.RecapFacts(r.Context(), c.C.ID, since, newsWeight(s.g))
		if err != nil {
			s.internal(w, err)
			return
		}
		rc := s.g.Recap(&view, own, heavy)
		out := api.Recap{Since: rc.Since, Tick: s.g.Tick(), Lines: []api.RecapLine{}, More: rc.More}
		for _, l := range rc.Lines {
			x := api.RecapLine{Rule: l.Rule, NPC: l.NPC}
			if l.NPC == "" {
				f := apiFacts([]fact.Fact{l.Fact})[0]
				x.Fact = &f
			}
			out.Lines = append(out.Lines, x)
		}
		reply(w, http.StatusOK, out)
	})
}

func newsWeight(g *game.Game) int64 {
	return sheets.IntParam(g.Rules().Book.WorldParams, "news-weight")
}

func (s *Server) npcHandler(w http.ResponseWriter, r *http.Request) {
	s.withChar(w, r, func(c *game.Char) {
		conv, err := s.g.Converse(c, r.URL.Query().Get("npc"))
		if err != nil {
			s.refused(w, err)
			return
		}
		out := api.Conversation{NPC: apiPerson(s.g, game.Person{Stub: conv.NPC, Saved: true}), Topics: []api.Topic{}, Last: conv.Last, Met: conv.Met, Digest: conv.Digest}
		for _, t := range conv.Topics {
			x := api.Topic{ID: t.ID, Line: t.Line, Own: t.Own, Choices: []api.Choice{}}
			for _, ch := range t.Choices {
				x.Choices = append(x.Choices, api.Choice{ID: ch.ID, Line: ch.Line, Effect: ch.Effect, Standing: ch.Standing, Coin: ch.Coin})
			}
			out.Topics = append(out.Topics, x)
		}
		key, err := s.banner(c.C.At)
		if err != nil {
			s.internal(w, err)
			return
		}
		out.Banner = key
		reply(w, http.StatusOK, out)
	})
}

func (s *Server) mapHandler(w http.ResponseWriter, r *http.Request) {
	radius, ok := intParam(r, "radius")
	if !ok {
		radius = mapRadius
	}
	radius = min(max(radius, 1), mapRadiusMax)
	s.withChar(w, r, func(c *game.Char) {
		g := s.g
		out := api.MapView{Tick: g.Tick(), Centre: apiHex(c.C.At), Radius: radius, Tiles: []api.Tile{}}
		crop := render.MapCrop{Centre: c.C.At, Radius: radius, At: c.C.At, ThreatLine: world.LineAt(g.Rules().Book, "ambush"),
			CorruptionLine: world.LineAt(g.Rules().Book, "corrupted-nodes")}
		if c.Long != nil {
			crop.Route = c.Long.Route
		}
		for _, h := range hex.DiscAt(c.C.At, radius) {
			t, known := apiTile(g, h)
			mt := render.MapTile{Hex: h, Known: known}
			if known {
				out.Tiles = append(out.Tiles, t)
				b := g.Rules().Gen.Baseline(h)
				mt.Terrain, mt.River, mt.Road, mt.Site, mt.Weather, mt.Region = t.Terrain, b.River, t.Road, t.Site, t.Weather, t.Region
				if v, ok := gauge(g, h, "threat"); ok {
					mt.Threat = v
				}
				if v, ok := gauge(g, h, "corruption"); ok {
					mt.Corruption = v
				}
			}
			crop.Tiles = append(crop.Tiles, mt)
		}
		key, err := s.picture("map", crop, func() (*render.Canvas, error) { return render.Map(crop), nil })
		if err != nil {
			s.internal(w, err)
			return
		}
		out.Image = key
		reply(w, http.StatusOK, out)
	})
}

func gauge(g *game.Game, h hex.Hex, id string) (int64, bool) {
	ri := g.World.RegionAt(h)
	if ri < 0 {
		return 0, false
	}
	return g.World.Regions[ri].Gauge[g.World.GaugeIndex(id)], true
}

func (s *Server) lexicon(w http.ResponseWriter, _ *http.Request) {
	b := s.rules.Book
	out := api.Lexicon{Names: map[string]string{}, Bands: []string{}}
	for _, n := range b.Names {
		out.Names[n.Ref] = n.Name
	}
	bands := slices.Clone(b.OddsBands)
	slices.SortFunc(bands, func(x, y sheets.OddsBand) int { return int(y.Rank - x.Rank) })
	for _, x := range bands {
		out.Bands = append(out.Bands, x.ID)
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) playerOf(w http.ResponseWriter, r *http.Request) {
	id, err := s.st.CharacterOf(r.Context(), r.URL.Query().Get("discordId"))
	if err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, api.Player{CharacterID: id})
}

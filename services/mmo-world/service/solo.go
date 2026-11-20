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
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

const (
	mapRadius    = 4    // tiles
	mapRadiusMax = 6    // tiles
	recentFacts  = 5    // facts shown on a place card
	mediaKept    = 1024 // cached images
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

// put draws a picture outside the cache's lock, so pictures render side
// by side; two draws of one key give the same bytes.
func (m *media) put(key string, draw func() ([]byte, error)) (string, error) {
	if _, ok := m.get(key); ok {
		return key, nil
	}
	b, err := draw()
	if err != nil {
		return "", err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.png == nil {
		m.png = map[string][]byte{}
	}
	if _, ok := m.png[key]; ok {
		return key, nil
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

// picture caches an image under a key derived from its input.
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

// withCharErr is withChar for a read that may refuse; it writes the
// refusal, or the internal error.
func (s *Server) withCharErr(w http.ResponseWriter, r *http.Request, f func(c *game.Char) error) bool {
	var err error
	if !s.withChar(w, r, func(c *game.Char) { err = f(c) }) {
		return false
	}
	if err != nil {
		s.refused(w, err)
	}
	return err == nil
}

// withChar runs a read for the character a query names, under the lock,
// and reports whether it ran; when it did not, the reply is written.
func (s *Server) withChar(w http.ResponseWriter, r *http.Request, f func(c *game.Char)) bool {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return false
	}
	defer unlock()
	c := s.charFor(w, r.URL.Query().Get("characterId"))
	if c != nil {
		f(c)
	}
	return c != nil
}

func (s *Server) sheet(w http.ResponseWriter, r *http.Request) {
	var out api.Sheet
	var err error
	var pictures []func() error
	if !s.withChar(w, r, func(c *game.Char) { out, err = s.apiSheet(c, &pictures) }) {
		return
	}
	if err == nil {
		for _, draw := range pictures {
			if err = draw(); err != nil {
				break
			}
		}
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) apiSheet(c *game.Char, pictures *[]func() error) (api.Sheet, error) {
	g := s.g
	out := api.Sheet{Character: apiCharacter(g, c), Start: c.Start, Kit: []api.Item{}, Pack: []api.Item{}, Standing: []api.Standing{},
		Record: []api.Count{}, Finds: []api.Find{}, Owed: c.Owed, Load: api.Load{Carried: c.Carried(), Capacity: g.Capacity(c)},
		Consent: api.Consent{SameServer: !c.HideSame, OtherServers: c.NameOther}, Vows: []string{}}
	for _, x := range g.PostedBy(c) {
		if x.State == goal.Live && x.Vow() && !x.Hidden {
			out.Vows = append(out.Vows, x.Title)
		}
	}
	worn := map[string]string{}
	for _, e := range c.C.Equipped {
		worn[e.Item] = e.Slot
	}
	for _, in := range c.C.Pack {
		it, err := s.apiItem(in, worn[in.ID], pictures)
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
		out.Standing = append(out.Standing, api.Standing{With: g.StandingName(x.Key), Value: x.N})
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
	for _, x := range c.C.Goals {
		out.Record = append(out.Record, api.Count{Key: "goals:" + x.Key, N: x.N, Unit: "goals"})
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

// apiItem prepares an item's card and queues its sigil for rendering.
func (s *Server) apiItem(in *item.Instance, worn string, pictures *[]func() error) (api.Item, error) {
	g := s.g
	r := g.Rules()
	out := api.Item{ID: in.ID, Kind: in.Kind, Worn: worn, Level: in.Level, XP: in.XP, Durability: in.Durability, Max: in.MaxDurability,
		Dormant: in.Dormant, Axes: []api.Part{}, Traits: []string{}, Picks: append([]string{}, in.Picks...), Offers: slices.Clone(in.Offers), Maker: in.Maker, Mount: in.Mount,
		WearIn: []string{}}
	if in.Mount != "" {
		out.Name, out.Slot = r.Name("mounts.kinds:"+in.Mount), char.Mount
		if m := r.Mounts.Kind(in.Mount); m != nil {
			out.Tier = m.Tier
		}
	}
	k, ok := g.Kinds.Kind(in.Kind)
	if ok {
		out.Name, out.Slot, out.Tier, out.Value = g.Kinds.Name(k.ID), k.Slot, k.Tier, r.Values.Kind(&g.Kinds, k)
		out.TraderPays = g.TraderPays(in)
		out.WearIn, out.Loads, out.Deck = append(out.WearIn, game.WearIn(k.Slot)...), game.Loads(k), game.IsDeck(k)
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
		body, err := json.Marshal(sig)
		if err != nil {
			return out, err
		}
		out.Sigil = render.Key("sigil", body)
		key := out.Sigil
		*pictures = append(*pictures, func() error {
			_, err := s.media.put(key, func() ([]byte, error) { return render.Sigil(sig).PNG() })
			return err
		})
	}
	if in.Exploit != nil {
		x, err := s.apiItem(in.Exploit, "", pictures)
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

// here reads the place under the lock, and its recent facts from the
// store after, so a slow query never holds up ticks.
func (s *Server) here(w http.ResponseWriter, r *http.Request) {
	var out api.Here
	var banner render.BannerInput
	if !s.withChar(w, r, func(c *game.Char) {
		out = s.apiHere(c)
		banner = s.bannerInput(c.C.At)
	}) {
		return
	}
	var err error
	if out.Banner, err = s.banner(banner); err == nil && out.Place.Tile.Region != "" {
		var recent []fact.Fact
		recent, err = s.st.RecentIn(r.Context(), out.Place.Tile.Region, recentFacts)
		out.Recent = apiFacts(recent)
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) apiHere(c *game.Char) api.Here {
	g := s.g
	h := c.C.At
	place := placeView(g, h)
	out := api.Here{Place: place, Name: g.PlaceName(h), Stations: []api.Station{}, Orders: []api.Order{}, Offers: []api.Offer{},
		People: []api.Person{}, Trails: []api.Trail{}, Search: g.CanSearch(c, h), Materials: []api.Stock{}, Forage: g.ForageYield(h), Recent: []api.Fact{},
		Downed: []api.Downed{}}
	for _, d := range g.DownedAt(c) {
		out.Downed = append(out.Downed, api.Downed{ID: d.C.ID, Name: g.OwnerName(ledger.Char(d.C.ID)), Called: g.Called(d)})
	}
	for _, st := range g.Stations(h) {
		out.Stations = append(out.Stations, api.Station{Kind: st.Kind, Tier: st.Tier, Fee: g.StationFee(st)})
	}
	out.Orders = apiOrders(g, c, h)
	for _, o := range g.Offers(h) {
		out.Offers = append(out.Offers, api.Offer{Asset: o.Asset, Price: o.Price})
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
	return out
}

func apiPerson(g *game.Game, p game.Person) api.Person {
	role := p.Role
	if row := g.Rules().NPC.Role(p.Role); row != nil {
		role = row.Role
	}
	return api.Person{ID: p.ID, Name: p.Name, Role: role, Kind: p.Kind, Traits: slices.Clone(p.Traits), Saved: p.Saved, Visit: p.Visit}
}

func (s *Server) bannerInput(h hex.Hex) render.BannerInput {
	g := s.g
	r := g.Rules()
	b := r.Gen.Baseline(h)
	in := render.BannerInput{Terrain: b.Terrain, Hour: (g.Tick() % sheets.TicksPerDay) / sheets.TicksPerHour, Settlement: g.IsSettlement(h)}
	if ri := g.World.RegionAt(h); ri >= 0 {
		reg := g.World.Regions[ri]
		in.Seed = world.RegionRef(ri)
		in.Threat, _ = g.World.GaugeAt(h, "threat")
		in.Corruption, _ = g.World.GaugeAt(h, "corruption")
		in.Danger = g.World.Past(h, "ambush")
		in.Overrun = g.World.Past(h, "overrun")
		in.Corrupted = g.World.Past(h, "corrupted-nodes")
		if reg.Holder >= 0 {
			if a := r.Values.Archetype(g.World.Factions[reg.Holder].Archetype); a != nil {
				in.Tags = a.Tags
			}
		}
	}
	if w, ok := g.World.Weather(h); ok {
		in.Weather = w.Kind
	}
	return in
}

func (s *Server) banner(in render.BannerInput) (string, error) {
	b := s.rules.Book
	return s.picture("banner", in, func() (*render.Canvas, error) { return render.Banner(in, b.BannerLayers, b.Palette) })
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
			x := api.Process{ID: p.ID, Stations: p.Stations, Methods: []string{}, NeedsSlot: game.NeedsSlot(p.ID)}
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

// recap reads the facts from the store outside the lock, then selects
// from them under it.
func (s *Server) recap(w http.ResponseWriter, r *http.Request) {
	var id string
	var since, weight int64
	if !s.withChar(w, r, func(c *game.Char) {
		id, since, weight = c.C.ID, max(c.Seen, s.g.Tick()-s.g.RecapWindow()), s.g.NewsWeight()
	}) {
		return
	}
	own, heavy, err := s.st.RecapFacts(r.Context(), id, since, weight)
	if err != nil {
		s.internal(w, err)
		return
	}
	s.withChar(w, r, func(c *game.Char) {
		view := *c
		view.Seen = since
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

func (s *Server) npcHandler(w http.ResponseWriter, r *http.Request) {
	var out api.Conversation
	var banner render.BannerInput
	var err error
	if !s.withChar(w, r, func(c *game.Char) {
		var conv game.Conversation
		conv, err = s.g.Converse(c, r.URL.Query().Get("npc"))
		if err != nil {
			return
		}
		out = api.Conversation{NPC: apiPerson(s.g, game.Person{Stub: conv.NPC, Saved: true}), Topics: []api.Topic{}, Last: conv.Last, Met: conv.Met, Digest: conv.Digest}
		for _, t := range conv.Topics {
			x := api.Topic{ID: t.ID, Line: t.Line, Own: t.Own, Choices: []api.Choice{}}
			for _, ch := range t.Choices {
				x.Choices = append(x.Choices, api.Choice{ID: ch.ID, Line: ch.Line, Effect: ch.Effect, Standing: ch.Standing, Coin: ch.Coin})
			}
			out.Topics = append(out.Topics, x)
		}
		banner = s.bannerInput(c.C.At)
	}) {
		return
	}
	if err != nil {
		s.refused(w, err)
		return
	}
	out.Banner, err = s.banner(banner)
	if err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) mapHandler(w http.ResponseWriter, r *http.Request) {
	radius, ok := intParam(r, "radius")
	if !ok {
		radius = mapRadius
	}
	radius = min(max(radius, 1), mapRadiusMax)
	var out api.MapView
	var crop render.MapCrop
	if !s.withChar(w, r, func(c *game.Char) {
		g := s.g
		out = api.MapView{Tick: g.Tick(), Centre: apiHex(c.C.At), Radius: radius, Tiles: []api.Tile{}}
		crop = render.MapCrop{Centre: c.C.At, Radius: radius, At: c.C.At}
		if c.Long != nil {
			crop.Route = slices.Clone(c.Long.Route)
		}
		for _, h := range hex.DiscAt(c.C.At, radius) {
			t, known := apiTile(g, h)
			mt := render.MapTile{Hex: h, Known: known}
			if known {
				out.Tiles = append(out.Tiles, t)
				b := g.Rules().Gen.Baseline(h)
				mt.Terrain, mt.River, mt.Road, mt.Site, mt.Weather, mt.Region = t.Terrain, b.River, t.Road, t.Site, t.Weather, t.Region
				mt.Danger = g.World.Past(h, "ambush")
				mt.Corrupted = g.World.Past(h, "corrupted-nodes")
				if v, ok := g.World.GaugeAt(h, "threat"); ok {
					mt.Threat = v
				}
				if v, ok := g.World.GaugeAt(h, "corruption"); ok {
					mt.Corruption = v
				}
			}
			crop.Tiles = append(crop.Tiles, mt)
		}
	}) {
		return
	}
	key, err := s.picture("map", crop, func() (*render.Canvas, error) { return render.Map(crop), nil })
	if err != nil {
		s.internal(w, err)
		return
	}
	out.Image = key
	reply(w, http.StatusOK, out)
}

func (s *Server) lexicon(w http.ResponseWriter, _ *http.Request) {
	b := s.rules.Book
	n := s.rules.CardNumbers()
	out := api.Lexicon{Names: map[string]string{}, Bands: sheets.BandsByRank(b), Starts: make([]string, 0, len(b.Starts)), Numbers: api.Numbers{AmbushLine: n.AmbushLine, OverrunLine: n.OverrunLine,
		CrawlTicks: n.CrawlTicks, WoundedTicks: n.WoundedTicks, FreeTicks: n.FreeTicks, StepMin: n.StepMin, StepMax: n.StepMax,
		BeatsMin: n.FirstBeatsMin, BeatsMax: n.FirstBeatsMax}}
	for _, n := range b.Names {
		out.Names[n.Ref] = n.Name
	}
	for _, start := range b.Starts {
		out.Starts = append(out.Starts, start.ID)
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

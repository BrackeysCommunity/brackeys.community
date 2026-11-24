package service

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
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

// pictureKey is the media key of a picture's input.
func pictureKey(kind string, input any) (string, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	return render.Key(kind, body), nil
}

// picture caches an image under a key derived from its input.
func (s *Server) picture(kind string, input any, draw func() (*render.Canvas, error)) (string, error) {
	key, err := pictureKey(kind, input)
	if err != nil {
		return "", err
	}
	return s.media.put(key, func() ([]byte, error) {
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
		b, ok = s.drawLate(r.Context(), key)
	}
	if !ok {
		refuse(w, http.StatusNotFound, api.Refusal{Code: api.CodeNotFound, Message: "no picture " + key})
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(b)
}

// drawLate draws a picture whose key a read served without drawing it: an
// art slot, or the portrait of a creature someone fights or hunts.
func (s *Server) drawLate(ctx context.Context, key string) ([]byte, bool) {
	kit, err := render.DefaultKit()
	if err != nil {
		return nil, false
	}
	palette := s.rules.Load().Book.Palette
	var got string
	switch render.KindOf(key) {
	case artKind:
		_, slots := artTable()
		slot, ok := slots[key]
		if !ok {
			return nil, false
		}
		got, err = s.picture(artKind, render.ArtInput{Slot: slot, Kit: kit.Digest}, func() (*render.Canvas, error) {
			return render.Art(slot, kit, palette)
		})
	case portraitKind:
		in, ok := s.portraitFor(ctx, key)
		if !ok {
			return nil, false
		}
		got, err = s.picture(portraitKind, in, func() (*render.Canvas, error) { return render.Portrait(in, kit, palette) })
	default:
		return nil, false
	}
	if err != nil {
		s.cfg.Log.Error("picture failed", "key", key, "err", err.Error())
		return nil, false
	}
	if got != key {
		s.cfg.Log.Error("picture drew under another key", "key", key, "got", got)
		return nil, false
	}
	return s.media.get(key)
}

// portraitFor is the input of a portrait key: from the keys reads served,
// else from one scan of the world for keys served before a restart. A key
// no scan found is not scanned for again.
func (s *Server) portraitFor(ctx context.Context, key string) (render.PortraitInput, bool) {
	if in, ok := portraits.input(key); ok {
		return in, true
	}
	if portraits.missed(key) {
		return render.PortraitInput{}, false
	}
	unlock, err := s.take(ctx, true)
	if err != nil {
		return render.PortraitInput{}, false
	}
	var in render.PortraitInput
	found := false
	for _, c := range s.g.Chars {
		if p, ok := fightPortrait(s.g, c); ok && portraitKey(p) == key {
			in, found = p, true
			break
		}
	}
	for i := 0; !found && i < len(s.g.Hunts); i++ {
		if p, ok := huntPortrait(s.g.Hunts[i]); ok && portraitKey(p) == key {
			in, found = p, true
		}
	}
	unlock()
	if !found {
		portraits.miss(key)
	}
	return in, found
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
		Consent: api.Consent{SameServer: !c.HideSame, OtherServers: c.NameOther}, Vows: []api.Vow{}}
	// A raise or a muster it posted is its guild's word, not its own.
	for _, x := range g.PostedBy(c) {
		if x.State == goal.Live && x.Vow() && !x.Hidden && x.Issuer.Kind == goal.ByCharacter {
			out.Vows = append(out.Vows, api.Vow{Title: x.Title, Broken: x.Broken})
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
	if n := c.C.Deeds.Get(game.DeedGiven); n > 0 {
		out.Record = append(out.Record, api.Count{Key: "given to guilds", N: n, Unit: "coin"})
	}
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
	viewer := ""
	if !s.withChar(w, r, func(c *game.Char) {
		out = s.apiHere(c)
		banner = s.bannerInput(c.C.At)
		viewer = c.C.ID
	}) {
		return
	}
	var err error
	if out.Banner, err = s.banner(banner); err == nil && out.Place.Tile.Region != "" {
		var recent []fact.Fact
		recent, err = s.st.RecentIn(r.Context(), out.Place.Tile.Region, recentFacts)
		out.Recent = scrubFirsts(viewer, apiFacts(recent))
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
		out.Downed = append(out.Downed, api.Downed{ID: d.C.ID, Name: charName(g, d.C.ID), Called: g.Called(d), Floor: d.C.Floor})
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
		if g.FloorClearedAt(h, max(c.C.Floor, 1)) {
			out.Dungeon = "cleared"
		}
		out.Floor = floorView(g, c)
	}
	for _, m := range g.Materials(h) {
		out.Materials = append(out.Materials, api.Stock{Material: m, Left: g.StockLeft(h, m), WorkedOut: g.WorkedOut(h, m)})
	}
	if sg, ok := g.Suggest(h); ok {
		out.Suggest = &api.Suggest{At: apiHex(sg.At), Tiles: sg.Tiles, Dir: sg.Dir}
	}
	if b, ok := g.BenchFor(c); ok {
		out.Bench = &api.BenchHere{Uses: b.Uses, UsesCap: b.UsesCap, Lessons: b.Lessons}
	}
	return out
}

func apiPerson(g *game.Game, p game.Person) api.Person {
	role := p.Role
	if row := g.Rules().NPC.Role(p.Role); row != nil {
		role = row.Role
	}
	return api.Person{ID: p.ID, Name: p.Name, Role: role, Kind: p.Kind, Traits: slices.Clone(p.Traits), Saved: p.Saved, Visit: p.Visit, Called: p.Called}
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
	if p := g.PlaceAt(h); p != nil {
		if st := p.Get(wallStructure); st != nil {
			in.Wall, in.WallDown = st.Tier, st.Closed()
		}
		in.Ruined = p.Ruined != 0
		in.City = !in.Ruined && (p.City != nil || p.Faction != nil)
		if a := g.TroubleAt(p.N); a != nil {
			if row := g.TroubleRow(a); row != nil {
				in.Trouble = row.ID
			}
		}
	}
	return in
}

// structural: the structure a banner draws as a settlement's palisade.
const wallStructure = "wall"

func (s *Server) banner(in render.BannerInput) (string, error) {
	b := s.rules.Load().Book
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
	if ap.Eye {
		out.Registered = &ap.Registered
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
				_, refused := s.g.CanNameKind(id, c.C.ID)
				out.Known = append(out.Known, api.Known{Kind: id, Name: s.g.Kinds.Name(id), Recipe: apiRecipe(k.Recipe), First: first, Renamable: refused == nil})
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
	var since, seenAt, weight int64
	if !s.withChar(w, r, func(c *game.Char) {
		id, since, weight = c.C.ID, max(c.Seen, s.g.Tick()-s.g.RecapWindow()), s.g.NewsWeight()
		seenAt = c.Seen
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
		t := s.g.Tick()
		out := api.Recap{Since: rc.Since, Tick: t, Lines: []api.RecapLine{}, More: rc.More,
			Day: t / sheets.TicksPerDay, AwayHours: (t - seenAt) / sheets.TicksPerHour}
		var told []api.Fact
		for _, l := range rc.Lines {
			x := api.RecapLine{Rule: l.Rule, Kind: l.Kind, NPC: l.NPC}
			if l.NPC == "" {
				f, _ := seen(s.g, c.C.ID, apiFact(l.Fact))
				x.Fact, x.Promotion = &f, renamable(s.g, c.C.ID, l.Fact)
				told = append(told, f)
			}
			out.Lines = append(out.Lines, x)
		}
		out.Names = factNames(s.g, c.C.ID, told...)
		reply(w, http.StatusOK, out)
	})
}

func (s *Server) npcHandler(w http.ResponseWriter, r *http.Request) {
	var out api.Conversation
	var banner render.BannerInput
	var err error
	if !s.withChar(w, r, func(c *game.Char) {
		var conv game.Conversation
		id := r.URL.Query().Get("npc")
		conv, err = s.g.Converse(c, id)
		if err != nil {
			return
		}
		out = api.Conversation{NPC: apiPerson(s.g, game.Person{Stub: conv.NPC, Saved: true}), Topics: []api.Topic{}, Last: conv.Last, Met: conv.Met, Digest: conv.Digest}
		if r.URL.Query().Get("dossier") == "1" {
			var d game.DossierView
			if d, err = s.g.Dossier(c, id); err != nil {
				return
			}
			out.Dossier = apiDossier(d)
		}
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

// apiDossier is a dossier as the wire carries it.
func apiDossier(d game.DossierView) *api.Dossier {
	out := &api.Dossier{Day: d.Day, Role: d.Role, Traits: slices.Clone(d.Traits), Faction: d.Faction, Place: d.Place,
		About: apiMemories(d.About), World: apiMemories(d.World), Oldest: apiMemories(d.Oldest), FoldedTotal: d.FoldedTotal, Names: d.Names}
	if out.Traits == nil {
		out.Traits = []string{}
	}
	for _, x := range d.Folded {
		out.Folded = append(out.Folded, api.TypeCount{Type: x.Key, Count: x.N})
	}
	return out
}

func apiMemories(ms []game.MemoryView) []api.Memory {
	out := make([]api.Memory, len(ms))
	for i, m := range ms {
		out[i] = api.Memory{Kind: m.Kind, Tick: m.Tick, Fact: m.Fact, Thing: m.Thing, Who: m.Who, N: m.N, Unit: m.Unit}
	}
	return out
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
			known := Sees(g, c, h)
			mt := render.MapTile{Hex: h, Known: known}
			if known {
				t := tileView(g, h)
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

// lexicon is the pack's names and the sheet numbers cards state, with the
// names of the materials the world has found.
func (s *Server) lexicon(w http.ResponseWriter, r *http.Request) {
	rules := s.rules.Load()
	b := rules.Book
	n := rules.CardNumbers()
	out := api.Lexicon{Names: map[string]string{}, Bands: sheets.BandsByRank(b), Starts: make([]string, 0, len(b.Starts)), Numbers: api.Numbers{AmbushLine: n.AmbushLine, OverrunLine: n.OverrunLine,
		CrawlTicks: n.CrawlTicks, WoundedTicks: n.WoundedTicks, FreeTicks: n.FreeTicks, StepMin: n.StepMin, StepMax: n.StepMax,
		BeatsMin: n.FirstBeatsMin, BeatsMax: n.FirstBeatsMax, RuinTroubles: rules.Story.RuinTroubles,
		CityStationCap: sheets.IntParam(b.SettlementParams, "city-station-cap"), RoadEnterTicks: n.RoadEnterTicks,
		CampTier: n.CampTier, MastersEase: n.MastersEase, CustomSeasons: n.CustomSeasons}}
	for _, n := range b.Names {
		out.Names[n.Ref] = n.Name
	}
	for _, start := range b.Starts {
		out.Starts = append(out.Starts, start.ID)
	}
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	maps.Copy(out.Names, materialNames(s.g))
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

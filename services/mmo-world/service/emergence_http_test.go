package service_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

var anyCharacter = regexp.MustCompile(`"c-\d+"`)

// promoted puts a promotion record and its fact into the held game as the
// core would have written them, and returns the record.
func promoted(t *testing.T, g *game.Game, p emerge.Promotion) emerge.Promotion {
	t.Helper()
	e := g.Emergence
	p.ID = e.NewID(p.Type)
	p.Season, p.Tick = e.Season, g.Tick()
	subjects := []fact.Ref{{Kind: "promotion", ID: p.ID}}
	if p.First != "" {
		subjects = append(subjects, char.Ref(p.First))
	}
	data := []fact.Datum{fact.S("type", string(p.Type)), fact.S("id", p.ID), fact.S("name", p.Name)}
	if p.At != nil {
		data = append(data, fact.At(*p.At)...)
	}
	id, err := g.Log.Append(fact.Fact{Tick: p.Tick, Kind: "promotion", Weight: 70, Subjects: subjects, Data: data})
	if err != nil {
		t.Fatal(err)
	}
	p.Fact = id
	e.Promotions = append(e.Promotions, p)
	return p
}

// variantScene gives a region a variant, its found material and the style
// it answered, all three first to the character, and returns the three.
func variantScene(t *testing.T, g *game.Game, first string, region int, at *hex.Hex) (style, variant, material emerge.Promotion, found sheets.Material) {
	t.Helper()
	b := g.Rules().Book
	row := b.Adaptations[0]
	base := b.Materials[0]
	found, ok := g.Rules().Emerge.Found(base, row.ID)
	if !ok {
		t.Fatalf("adaptation %s makes nothing of %s", row.ID, base.ID)
	}
	arch := b.Creatures[0].ID
	e := g.Emergence
	style = promoted(t, g, emerge.Promotion{Type: emerge.Style, Name: "Ember Hands", First: first, Region: region, At: at, Of: "edge+keen"})
	e.Styles[emerge.StyleKey{Region: region, Style: "edge+keen"}] = &emerge.StyleTrace{Key: emerge.StyleKey{Region: region, Style: "edge+keen"},
		Resisted: "keen", Lead: "edge", Done: style.ID}
	variant = promoted(t, g, emerge.Promotion{Type: emerge.Variant, Name: "Plated beast", First: first, Region: region, Of: arch})
	e.Variants = append(e.Variants, &emerge.VariantRec{ID: variant.ID, Region: region, Archetype: arch, Row: row.ID, Style: "edge+keen",
		Resisted: "keen", Material: found.ID})
	e.Materials = append(e.Materials, found)
	material = promoted(t, g, emerge.Promotion{Type: emerge.Material, Name: "Plated stuff", First: first, Region: region, Of: found.ID})
	return style, variant, material, found
}

func rawRead(t *testing.T, r *running, cli bool, path string, status int) string {
	t.Helper()
	return string(read[json.RawMessage](t, r, cli, path, status))
}

// TestStoryPromotions reads the chronicle's promotions after a fact id:
// only the promotion kinds, each with its record (the variant's archetype
// and material, a route's places), none naming its first, capped like the
// events. An event naming a road or a route carries it too.
func TestStoryPromotions(t *testing.T) {
	r := startOn(t, pgtest.Pool(t), io.Discard, nil)
	ctx := context.Background()
	a, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	advance(t, ctx, r, 1)

	var style, variant, route emerge.Promotion
	var region int
	var archName string
	release := r.srv.Hold()
	g := r.srv.Game()
	region = g.World.RegionAt(g.SettlementHex(n))
	style, variant, _, _ = variantScene(t, g, a.ID, region, nil)
	route = promoted(t, g, emerge.Promotion{Type: emerge.Route, Name: "Here–There", Region: region, Places: []int{n, n + 1}})
	archName = g.Rules().Name("creatures.archetypes:" + variant.Of)
	release()
	advance(t, ctx, r, 2)

	put := func(id int64, kind string, subjects []fact.Ref, data ...fact.Datum) {
		putFact(t, r, fact.Fact{ID: fact.ID(id), Tick: 1, Kind: kind, Weight: 70, Subjects: subjects, Data: data})
	}
	mine := char.Ref(a.ID)
	promo := func(p emerge.Promotion) []fact.Ref { return []fact.Ref{{Kind: "promotion", ID: p.ID}, mine} }
	put(storyIDs+1, "promotion", promo(style), fact.S("type", "style"), fact.S("id", style.ID), fact.S("by", a.ID))
	put(storyIDs+2, "road.grew", []fact.Ref{{Kind: "promotion", ID: route.ID}})
	put(storyIDs+3, "promotion", promo(variant), fact.S("type", "variant"), fact.S("id", variant.ID))
	put(storyIDs+4, "legend.laid", []fact.Ref{{Kind: "promotion", ID: "legend:99"}})
	put(storyIDs+5, "promotion", []fact.Ref{{Kind: "promotion", ID: route.ID}}, fact.S("type", "route"), fact.S("id", route.ID))
	put(storyIDs+6, "custom.held", []fact.Ref{{Kind: "promotion", ID: "custom:98"}, arc.SettlementRef(n)})
	put(storyIDs+7, "season.added", nil, fact.N("styles", 1), fact.S("first", "Ember Hands"))
	put(storyIDs+8, "caravan.robbed", []fact.Ref{{Kind: "promotion", ID: route.ID}}, fact.S("id", route.ID+"@7"))

	path := func(after int64) string { return fmt.Sprintf("%s?after=%d", api.PathStoryPromotions, after) }
	body := rawRead(t, r, true, path(storyIDs), 200)
	if m := anyCharacter.FindString(body); m != "" {
		t.Fatalf("the promotions name the character %s: %s", m, body)
	}
	var ev api.StoryEvents
	if err := json.Unmarshal([]byte(body), &ev); err != nil {
		t.Fatal(err)
	}
	var kinds []string
	for _, e := range ev.Events {
		kinds = append(kinds, e.Fact.Kind)
	}
	if !slices.Equal(kinds, []string{"promotion", "promotion", "legend.laid", "promotion", "custom.held", "season.added"}) || ev.Last != storyIDs+7 {
		t.Fatalf("promotions %v, last %d", kinds, ev.Last)
	}
	st, vr, lg, rt := ev.Events[0].Promotion, ev.Events[1].Promotion, ev.Events[2].Promotion, ev.Events[3].Promotion
	switch {
	case st == nil || st.ID != style.ID || st.Name != "Ember Hands" || st.Resists != "keen" || st.Region == "":
		t.Fatalf("the style's record: %+v", st)
	case vr == nil || vr.Of != variant.Of || vr.OfName != archName || archName == "" || vr.Material == "" || vr.Resists != "keen":
		t.Fatalf("the variant's record: %+v (archetype %q)", vr, archName)
	case lg != nil:
		t.Fatalf("a legend the game does not hold has a record: %+v", lg)
	case rt == nil || !slices.Equal(rt.Places, []int{n, n + 1}) || rt.Type != "route":
		t.Fatalf("the route's record: %+v", rt)
	case st.Yours || st.Renamable || vr.Yours || vr.Renamable:
		t.Fatal("a public read marks a promotion as the viewer's")
	}
	for _, e := range ev.Events {
		for _, s := range e.Fact.Subjects {
			if s.Kind == "character" {
				t.Fatalf("%s names a character", e.Fact.Kind)
			}
		}
	}

	events := read[api.StoryEvents](t, r, true, fmt.Sprintf("%s?after=%d", api.PathStoryEvents, storyIDs), 200)
	if i := slices.IndexFunc(events.Events, func(e api.StoryEvent) bool { return e.Fact.Kind == "caravan.robbed" }); i < 0 ||
		events.Events[i].Promotion == nil || events.Events[i].Promotion.ID != route.ID {
		t.Fatalf("the robbed caravan's event: %+v", events.Events)
	}

	for i := range int64(105) {
		put(storyIDs+100+i, "promotion", []fact.Ref{{Kind: "promotion", ID: route.ID}})
	}
	ev = read[api.StoryEvents](t, r, true, path(storyIDs+7), 200)
	if len(ev.Events) != 100 || ev.Last != storyIDs+199 {
		t.Fatalf("a long read: %d events, last %d", len(ev.Events), ev.Last)
	}
	ev = read[api.StoryEvents](t, r, true, path(ev.Last), 200)
	if len(ev.Events) != 5 || ev.Last != storyIDs+204 {
		t.Fatalf("the rest: %d events, last %d", len(ev.Events), ev.Last)
	}
	read[api.Refusal](t, r, true, api.PathStoryPromotions+"?after=-1", 400)
}

// TestOperatorEmergence reads the dashboard: the eight types and the
// stored traces, the newest promotions without their firsts, operator
// token only, and a refusal for a world that keeps no emergence.
func TestOperatorEmergence(t *testing.T) {
	r := start(t, io.Discard)
	a, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	d := read[api.Emergence](t, r, false, api.PathOperatorEmergence, 200)
	var types []string
	for _, c := range d.Promotions {
		types = append(types, c.Type)
	}
	want := make([]string, len(emerge.Types))
	for i, ty := range emerge.Types {
		want[i] = string(ty)
	}
	if !slices.Equal(types, want) || d.Need < 1 || d.Active < 1 || len(d.Traces) == 0 || d.Recent == nil || len(d.Recent) != 0 || d.PromotionsHealthy {
		t.Fatalf("a fresh world's dashboard: %+v", d)
	}
	read[api.Refusal](t, r, true, api.PathOperatorEmergence, 401)

	release := r.srv.Hold()
	g := r.srv.Game()
	style, _, _, _ := variantScene(t, g, a.ID, g.World.RegionAt(g.SettlementHex(n)), nil)
	release()
	body := rawRead(t, r, false, api.PathOperatorEmergence, 200)
	if m := anyCharacter.FindString(body); m != "" {
		t.Fatalf("the dashboard names the character %s", m)
	}
	if err := json.Unmarshal([]byte(body), &d); err != nil {
		t.Fatal(err)
	}
	if len(d.Recent) != 3 || d.Recent[2].ID != style.ID || d.Recent[0].Type != "material" {
		t.Fatalf("the newest promotions: %+v", d.Recent)
	}

	release = r.srv.Hold()
	kept := g.Emergence
	g.Emergence = nil
	release()
	read[api.Refusal](t, r, false, api.PathOperatorEmergence, 404)
	release = r.srv.Hold()
	g.Emergence = kept
	release()
}

// TestEmergenceStartAtOpen keeps a world from before emergence, opens it,
// and expects the service to start emergence once, after the season, as
// a recorded command the world replays through. Opened again, it is not
// started again.
func TestEmergenceStartAtOpen(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	sec, _ := testkit.Secrets(t, "mmo/test-master", world)
	book := testkit.Book(t)
	g, err := game.New(testkit.Rules(t, book, sec.Keys))
	if err != nil {
		t.Fatal(err)
	}
	g.Emergence = nil
	g.Attach(g.Rules())
	digest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	st := store.New(pool, world)
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	if err := st.Create(ctx, store.Meta{ID: world, KeyVersion: sec.KeyVersion, KeyCheck: sec.Keys.Check(), RulesEpoch: sec.Epoch, SheetsDigest: digest,
		StartedAt: now, TickSeconds: 600}, g); err != nil {
		t.Fatal(err)
	}
	testkit.Ticks(t, ctx, st, g, 3)
	if g.Emergence != nil {
		t.Fatal("a world kept with no emergence grew it")
	}
	kept := func(c *service.Config) { c.Disposable = false }
	var logs bytes.Buffer
	r := startOn(t, pool, &logs, kept)
	if !strings.Contains(logs.String(), "EMERGENCE STARTED") || strings.Contains(logs.String(), "SEASON STARTED") {
		t.Fatalf("the open's log:\n%s", logs.String())
	}
	if n := actionCount(t, ctx, r, "emergence-start"); n != 1 {
		t.Fatalf("%d emergence starts recorded", n)
	}
	d := read[api.Emergence](t, r, false, api.PathOperatorEmergence, 200)
	if d.Day != 0 || len(d.Recent) != 0 {
		t.Fatalf("the started dashboard: %+v", d)
	}
	var started int
	if err := r.pool.QueryRow(ctx, "SELECT count(*) FROM mmo.fact WHERE world_id = $1 AND kind = 'emergence.started'", world).Scan(&started); err != nil {
		t.Fatal(err)
	}
	if started != 1 {
		t.Fatalf("%d emergence.started facts", started)
	}
	tick, first := digest2(t, r)
	advance(t, ctx, r, tick+1)
	tick, ticked := digest2(t, r)
	replays(t, ctx, r, tick, ticked)

	r.halt()
	logs.Reset()
	again := startOn(t, pool, &logs, kept)
	if strings.Contains(logs.String(), "EMERGENCE STARTED") || actionCount(t, ctx, again, "emergence-start") != 1 {
		t.Fatalf("a world keeping emergence was started again:\n%s", logs.String())
	}
	if _, d := digest2(t, again); d != ticked || d == first {
		t.Fatalf("reopened at %s, closed at %s", d, ticked)
	}
}

// TestHiddenClassOffWire: a hidden class is never sent until someone
// finds it, and is then sent to everyone marked found.
func TestHiddenClassOffWire(t *testing.T) {
	r := start(t, io.Discard)
	ctx := context.Background()
	rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "c1", DiscordID: "u-1", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	var hidden []string
	for _, row := range r.book.Classes {
		if row.Hidden {
			hidden = append(hidden, row.ID)
		}
	}
	if len(hidden) < 2 {
		t.Fatalf("the book hides %v", hidden)
	}
	classes := func() map[string]api.Class {
		cs := read[api.Classes](t, r, true, api.PathClasses+"?characterId="+rep.Character.ID, 200)
		out := map[string]api.Class{}
		for _, c := range cs.Classes {
			out[c.ID] = c
		}
		return out
	}
	before := classes()
	for _, id := range hidden {
		if _, ok := before[id]; ok {
			t.Fatalf("the hidden class %s was sent before anyone found it", id)
		}
	}
	if len(before) != len(r.book.Classes)-len(hidden) {
		t.Fatalf("%d classes sent of %d", len(before), len(r.book.Classes))
	}
	for _, c := range before {
		if c.Found {
			t.Fatalf("the open class %s is marked found", c.ID)
		}
	}

	release := r.srv.Hold()
	r.srv.Game().FoundClasses = append(r.srv.Game().FoundClasses, hidden[0])
	release()
	after := classes()
	if c, ok := after[hidden[0]]; !ok || !c.Found || len(c.Tiers) == 0 || len(c.Needs) == 0 {
		t.Fatalf("the found class %s: %+v", hidden[0], c)
	}
	if _, ok := after[hidden[1]]; ok {
		t.Fatalf("the class %s was sent unfound", hidden[1])
	}
}

// TestLexiconFound: the lexicon names each found material beside the
// pack's, under its shown name, and an Activity state names the found
// materials it shows and nothing else.
func TestLexiconFound(t *testing.T) {
	r := start(t, io.Discard)
	a, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	lexicon := func() api.Lexicon { return read[api.Lexicon](t, r, true, api.PathLexicon, 200) }
	plain := lexicon()

	release := r.srv.Hold()
	g := r.srv.Game()
	_, _, material, found := variantScene(t, g, a.ID, g.World.RegionAt(g.SettlementHex(n)), nil)
	release()
	key := "items.materials:" + found.ID
	lx := lexicon()
	if lx.Names[key] != material.Name || len(lx.Names) != len(plain.Names)+1 {
		t.Fatalf("the lexicon names %q as %q, %d names against %d", key, lx.Names[key], len(lx.Names), len(plain.Names))
	}
	release = r.srv.Hold()
	g.Emergence.Promotion(material.ID).Named = "Shellhide"
	c := g.Char(a.ID)
	goods := c.C.Goods
	c.C.Goods = append(slices.Clone(goods), item.Spoil{Material: found.ID, Qty: 2})
	st := service.Filter(g, c, api.Viewer{}, 0, time.Time{})
	c.C.Goods = goods
	bare := service.Filter(g, c, api.Viewer{}, 0, time.Time{})
	release()
	if lexicon().Names[key] != "Shellhide" {
		t.Fatal("the lexicon keeps a renamed material's old name")
	}
	if len(st.Names) != 1 || st.Names[key] != "Shellhide" {
		t.Fatalf("the state's names: %v", st.Names)
	}
	if bare.Names != nil {
		t.Fatalf("a state showing no found material names %v", bare.Names)
	}
}

// TestPromoteNameOverChat renames a promotion from chat: another character
// is refused not-first, the first renames it once and is refused a second
// time, an unknown promotion is no-such-row. The first's recap line offers
// the rename; another's does not, and names nobody.
func TestPromoteNameOverChat(t *testing.T) {
	r := start(t, io.Discard)
	ctx := context.Background()
	a, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	bRep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "c-b", DiscordID: "u-b", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	b := bRep.Character
	advance(t, ctx, r, 2)

	release := r.srv.Hold()
	g := r.srv.Game()
	at := g.Char(a.ID).C.At
	style, _, _, _ := variantScene(t, g, a.ID, g.World.RegionAt(g.SettlementHex(n)), &at)
	release()
	advance(t, ctx, r, 3)

	recapLine := func(id string) (api.RecapLine, bool) {
		rc := read[api.Recap](t, r, true, api.PathRecap+"?characterId="+id, 200)
		for _, l := range rc.Lines {
			if l.Fact != nil && l.Fact.ID == int64(style.Fact) {
				return l, true
			}
		}
		return api.RecapLine{}, false
	}
	if l, ok := recapLine(a.ID); !ok || l.Promotion != style.ID {
		t.Fatalf("the first's recap line: %+v %v", l, ok)
	}
	if l, ok := recapLine(b.ID); ok && (l.Promotion != "" || slices.ContainsFunc(l.Fact.Subjects, func(s api.Ref) bool { return s.ID == a.ID })) {
		t.Fatalf("another's recap line: %+v", l)
	}

	name := func(key, who, id, text string) (api.ActionReply, *api.Refusal) {
		t.Helper()
		o, err := r.cli.Options(ctx, who)
		if err != nil {
			t.Fatal(err)
		}
		rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: key, CharacterID: who, Version: o.Version, Kind: api.ActPromoteName, Option: id, Note: text})
		if err != nil {
			t.Fatal(err)
		}
		return rep, ref
	}
	if _, ref := name("n-1", b.ID, style.ID, "Mine Now"); ref == nil || ref.Code != api.CodeNotFirst {
		t.Fatalf("another renaming: %+v", ref)
	}
	if _, ref := name("n-2", a.ID, "style:999", "Nothing"); ref == nil || ref.Code != api.CodeNoSuchRow {
		t.Fatalf("renaming no promotion: %+v", ref)
	}
	rep, ref := name("n-3", a.ID, style.ID, "Cinder Grip")
	if ref != nil || !slices.ContainsFunc(rep.Facts, func(f api.Fact) bool { return f.Kind == "promotion.renamed" }) {
		t.Fatalf("the first's rename: %+v %+v", rep.Facts, ref)
	}
	if _, ref := name("n-4", a.ID, style.ID, "Again"); ref == nil || ref.Code != api.CodeNamed {
		t.Fatalf("a second rename: %+v", ref)
	}
	if l, ok := recapLine(a.ID); ok && l.Promotion != "" {
		t.Fatalf("a named promotion still offers a rename: %+v", l)
	}
}

// TestPromotionRecap answers the line of one promotion while its first may
// name it, after the since-you-left recap has moved past it: another
// character and a named promotion get no line.
func TestPromotionRecap(t *testing.T) {
	r := start(t, io.Discard)
	ctx := context.Background()
	a, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	bRep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "c-b", DiscordID: "u-b", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	b := bRep.Character
	advance(t, ctx, r, 2)

	release := r.srv.Hold()
	g := r.srv.Game()
	at := g.Char(a.ID).C.At
	style, _, _, _ := variantScene(t, g, a.ID, g.World.RegionAt(g.SettlementHex(n)), &at)
	release()
	advance(t, ctx, r, 3)

	act := func(key, who, kind, option, note string) *api.Refusal {
		t.Helper()
		o, err := r.cli.Options(ctx, who)
		if err != nil {
			t.Fatal(err)
		}
		_, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: key, CharacterID: who, Version: o.Version, Kind: kind, Option: option, Note: note})
		if err != nil {
			t.Fatal(err)
		}
		return ref
	}
	carries := func(rc api.Recap) bool {
		return slices.ContainsFunc(rc.Lines, func(l api.RecapLine) bool { return l.Fact != nil && l.Fact.ID == int64(style.Fact) })
	}
	plain := func(who string) api.Recap {
		return read[api.Recap](t, r, true, api.PathRecap+"?characterId="+who, 200)
	}
	promotion := func(who string) api.Recap {
		return read[api.Recap](t, r, true, api.PathRecap+"?characterId="+who+"&promotion="+style.ID, 200)
	}

	if !carries(plain(a.ID)) {
		t.Fatal("the first's recap does not carry the promotion before a look")
	}
	if ref := act("l-1", a.ID, api.ActLook, "", ""); ref != nil {
		t.Fatalf("look: %+v", ref)
	}
	advance(t, ctx, r, 4)
	if rc := plain(a.ID); carries(rc) {
		t.Fatalf("the recap after a look still carries the promotion: %+v", rc.Lines)
	}
	rc := promotion(a.ID)
	if len(rc.Lines) != 1 || rc.Lines[0].Promotion != style.ID || rc.Lines[0].Fact == nil ||
		rc.Lines[0].Fact.ID != int64(style.Fact) || rc.Lines[0].Fact.Kind != game.FactPromotion {
		t.Fatalf("the first's promotion line: %+v", rc.Lines)
	}
	if rc := promotion(b.ID); len(rc.Lines) != 0 {
		t.Fatalf("another's promotion line: %+v", rc.Lines)
	}
	if ref := act("n-1", a.ID, api.ActPromoteName, style.ID, "Cinder Grip"); ref != nil {
		t.Fatalf("the first's rename: %+v", ref)
	}
	if rc := promotion(a.ID); len(rc.Lines) != 0 {
		t.Fatalf("a named promotion still answers a line: %+v", rc.Lines)
	}
	if rc := read[api.Recap](t, r, true, api.PathRecap+"?characterId="+a.ID+"&promotion=style:999", 200); len(rc.Lines) != 0 {
		t.Fatalf("no such promotion answers a line: %+v", rc.Lines)
	}
}

// TestEmergentTile shows a road by name with its toll while tolled and no
// toll while cut, and a camp and a haunt on the tile a character stands on.
func TestEmergentTile(t *testing.T) {
	r := start(t, io.Discard)
	a, _ := founder(t, r, "c-admin", "u-admin", "srv-1")
	release := r.srv.Hold()
	defer release()
	g := r.srv.Game()
	c := g.Char(a.ID)
	h := c.C.At
	e := g.Emergence
	day := g.Tick() / sheets.TicksPerDay
	road := promoted(t, g, emerge.Promotion{Type: emerge.Road, Name: "the Yard road", Region: g.World.RegionAt(h), At: &h})
	camp := promoted(t, g, emerge.Promotion{Type: emerge.Camp, Name: "the Yard camp", Region: g.World.RegionAt(h), At: &h})
	e.Roads[h] = road.ID
	rec := &emerge.RoadRec{ID: road.ID, Region: road.Region, Tiles: 1, TollUntil: day + 2}
	e.RoadRecs[road.ID] = rec
	e.Camps[h] = &emerge.CampRec{ID: camp.ID, Station: "bench"}
	e.Haunts[h] = &emerge.HauntRec{ID: camp.ID}
	tile := func() api.Tile { return service.Filter(g, c, api.Viewer{}, 0, time.Time{}).Place.Tile }
	if x := tile(); x.RoadName != "" {
		t.Fatalf("a road record on a tile the world has not made a road: %+v", x)
	}
	g.World.Tile(h).Road = 1
	x := tile()
	if x.RoadName != road.Name || x.Toll != g.Rules().Emerge.P.TollCoin || x.Toll == 0 || x.Cut || x.Camp != camp.Name || !x.Haunted {
		t.Fatalf("the tolled road's tile: %+v", x)
	}
	rec.CutUntil = day + 1
	if x = tile(); !x.Cut || x.Toll != 0 {
		t.Fatalf("the cut road's tile: %+v", x)
	}
	g.World.Tile(h).Road = 0
	delete(e.Roads, h)
	delete(e.Camps, h)
	delete(e.Haunts, h)
}

// TestVariantSeen names an overland encounter with the region's variant by
// the variant's shown name and row, and no other creature.
func TestVariantSeen(t *testing.T) {
	g, err := game.New(testkit.Rules(t, testkit.Book(t), keys.Throwaway("variant-seen")))
	if err != nil {
		t.Fatal(err)
	}
	b := g.Rules().Book
	h := g.SettlementHex(0)
	region := g.World.RegionAt(h)
	arch, row := b.Creatures[0].ID, b.Adaptations[0].ID
	drop := "found." + row + "." + b.Materials[0].ID
	e := g.Emergence
	id := e.NewID(emerge.Variant)
	e.Promotions = append(e.Promotions, emerge.Promotion{ID: id, Type: emerge.Variant, Name: "Plated beast", Region: region, Of: arch})
	e.Variants = append(e.Variants, &emerge.VariantRec{ID: id, Region: region, Archetype: arch, Row: row, Material: drop})
	met := &fight.Encounter{Creature: fight.Creature{Archetype: arch, Drops: []string{drop}}}
	if name, r := service.VariantSeen(g, h, met); name != "Plated beast" || r != row {
		t.Fatalf("the variant is seen as %q, %q", name, r)
	}
	e.Promotion(id).Named = "Shellback"
	if name, _ := service.VariantSeen(g, h, met); name != "Shellback" {
		t.Fatalf("the renamed variant is seen as %q", name)
	}
	plain := &fight.Encounter{Creature: fight.Creature{Archetype: arch, Drops: []string{b.Materials[0].ID}}}
	floor := &fight.Encounter{Creature: met.Creature, Floor: 1}
	for _, x := range []*fight.Encounter{plain, floor} {
		if name, r := service.VariantSeen(g, h, x); name != "" || r != "" {
			t.Fatalf("%+v is seen as the variant %q, %q", x.Creature, name, r)
		}
	}
}

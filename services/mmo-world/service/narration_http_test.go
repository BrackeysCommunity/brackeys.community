package service_test

import (
	"context"
	"fmt"
	"io"
	"maps"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store/pgtest"
)

// noCharacterNamed fails when a names map holds a character's ref or name.
func noCharacterNamed(t *testing.T, what string, names map[string]string) {
	t.Helper()
	for k, v := range names {
		if strings.HasPrefix(k, "character:") || anyCharacter.MatchString(strconv.Quote(v)) || v == "" {
			t.Fatalf("%s names %s as %q", what, k, v)
		}
	}
}

// namesAre fails unless names holds want, each as the world calls it.
func namesAre(t *testing.T, what string, names, want map[string]string) {
	t.Helper()
	for k, v := range want {
		if names[k] != v {
			t.Fatalf("%s: %s is %q, want %q (all: %v)", what, k, names[k], v, names)
		}
	}
}

// TestNarrationWire: the chronicle, a fact's causes, the events and the
// promotions name their refs as the world does and never a character; the
// recap says how long its reader was away, past its window; a dossier
// leaves a conversation as it was; and the arc kit lists what a proposed
// row may name.
func TestNarrationWire(t *testing.T) {
	t.Setenv(service.EnvSheets, sheetfs.ModuleRoot())
	r := startOn(t, pgtest.Pool(t), io.Discard, nil)
	ctx := context.Background()
	a, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	advance(t, ctx, r, sheets.TicksPerDay+1)

	release := r.srv.Hold()
	g := r.srv.Game()
	region := g.World.RegionAt(g.SettlementHex(n))
	to := min(n+1, len(g.Places)-1)
	want := map[string]string{
		"settlement:" + strconv.Itoa(n):    g.PlaceName(g.SettlementHex(n)),
		"settlement:" + strconv.Itoa(to):   g.PlaceName(g.SettlementHex(to)),
		"region:r-" + strconv.Itoa(region): g.RegionName(region),
		"faction:f-0":                      g.FactionName(0),
	}
	release()

	id := fact.ID(storyIDs)
	put := func(kind string, subjects []fact.Ref, causes []fact.ID, data ...fact.Datum) fact.ID {
		id++
		putFact(t, r, fact.Fact{ID: id, Tick: 10 + int64(id-storyIDs), Kind: kind, Weight: 90, Subjects: subjects, Data: data, Causes: causes})
		return id
	}
	raised := put("city.raised", []fact.Ref{arc.SettlementRef(n)}, nil)
	slain := put("guardian.slain", []fact.Ref{char.Ref(a.ID), arc.RegionRef(region)}, nil, fact.S("by", a.ID))
	city := put("faction.city", []fact.Ref{arc.FactionRef(0)}, []fact.ID{raised, slain}, fact.S("region", arc.RegionRef(region).ID), fact.N("settlement", int64(n)))
	put("caravan.departed", nil, nil, fact.N("from", int64(n)), fact.N("to", int64(to)))
	put("promotion", []fact.Ref{{Kind: "promotion", ID: "style:1"}, char.Ref(a.ID), arc.SettlementRef(n)}, nil, fact.S("type", "style"), fact.S("id", "style:1"), fact.S("by", a.ID))

	ch := read[api.Chronicle](t, r, true, api.PathChronicle+"?server=srv-1&day=0", 200)
	noCharacterNamed(t, "the chronicle", ch.Names)
	namesAre(t, "the chronicle", ch.Names, want)
	if ch.Cover == nil || ch.Cover.Key == "" || !slices.Contains(render.Slots, ch.Cover.Slot) {
		t.Fatalf("a chronicle with no cover from the kit: %+v", ch.Cover)
	}

	fc := read[api.FactCauses](t, r, true, fmt.Sprintf("%s?id=%d&characterId=%s", api.PathChronicleFact, city, a.ID), 200)
	noCharacterNamed(t, "a fact's causes", fc.Names)
	namesAre(t, "a fact's causes", fc.Names, map[string]string{"faction:f-0": want["faction:f-0"], "settlement:" + strconv.Itoa(n): want["settlement:"+strconv.Itoa(n)],
		"region:r-" + strconv.Itoa(region): want["region:r-"+strconv.Itoa(region)]})

	promos := read[api.StoryEvents](t, r, true, fmt.Sprintf("%s?after=%d", api.PathStoryPromotions, storyIDs), 200)
	if len(promos.Events) != 1 {
		t.Fatalf("promotions: %+v", promos.Events)
	}
	noCharacterNamed(t, "a promotion", promos.Events[0].Names)
	namesAre(t, "a promotion", promos.Events[0].Names, map[string]string{"settlement:" + strconv.Itoa(n): want["settlement:"+strconv.Itoa(n)]})
	events := read[api.StoryEvents](t, r, true, fmt.Sprintf("%s?after=%d", api.PathStoryEvents, storyIDs), 200)
	for _, e := range events.Events {
		noCharacterNamed(t, e.Fact.Kind, e.Names)
		if e.Art == nil || e.Art.Key == "" || !slices.Contains(render.Slots, e.Art.Slot) {
			t.Fatalf("%s has no art from the kit: %+v", e.Fact.Kind, e.Art)
		}
	}

	// The recap: away since the character was made, past the window it reads.
	release = r.srv.Hold()
	window := r.srv.Game().RecapWindow()
	release()
	advance(t, ctx, r, window+3*sheets.TicksPerHour+1)
	release = r.srv.Hold()
	g = r.srv.Game()
	seenAt, tick := g.Char(a.ID).Seen, g.Tick()
	release()
	rc := read[api.Recap](t, r, true, api.PathRecap+"?characterId="+a.ID, 200)
	if rc.Since <= seenAt || rc.AwayHours != (tick-seenAt)/sheets.TicksPerHour || rc.AwayHours <= window/sheets.TicksPerHour || rc.Day != tick/sheets.TicksPerDay {
		t.Fatalf("the recap: since %d, %d hours away, day %d; seen at %d, tick %d", rc.Since, rc.AwayHours, rc.Day, seenAt, tick)
	}
	for k := range rc.Names {
		if strings.HasPrefix(k, "character:") && k != "character:"+a.ID {
			t.Fatalf("the recap names another character: %v", rc.Names)
		}
	}

	// The dossier: the same conversation, and the game as it was.
	here := read[api.Here](t, r, true, api.PathHere+"?characterId="+a.ID, 200)
	if len(here.People) == 0 {
		t.Fatal("nobody at the settlement")
	}
	npc := here.People[0].ID
	o, err := r.cli.Options(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "meet", Kind: api.ActTalk, CharacterID: a.ID, Version: o.Version, NPC: npc}); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	path := api.PathNPC + "?characterId=" + url.QueryEscape(a.ID) + "&npc=" + url.QueryEscape(npc)
	plain := read[api.Conversation](t, r, true, path, 200)
	_, before := digest(t, ctx, r)
	with := read[api.Conversation](t, r, true, path+"&dossier=1", 200)
	if _, after := digest(t, ctx, r); after != before {
		t.Fatal("a dossier changed the game")
	}
	if plain.Dossier != nil || with.Dossier == nil || with.Digest != plain.Digest || !reflect.DeepEqual(with.Topics, plain.Topics) || with.Last != plain.Last {
		t.Fatalf("with a dossier: %+v\nwithout: %+v", with, plain)
	}
	if d := with.Dossier; d.Place == "" || d.Role == "" || d.Names["npc:"+npc] == "" || d.Day != tick/sheets.TicksPerDay {
		t.Fatalf("the dossier: %+v", d)
	}

	// The arc kit.
	read[api.Refusal](t, r, true, api.PathArcKit, 401)
	kit := read[api.ArcKit](t, r, false, api.PathArcKit, 200)
	if !slices.Equal(kit.When, slices.Sorted(maps.Keys(arc.Predicates))) || len(kit.When) == 0 {
		t.Fatalf("the kit's predicates: %v", kit.When)
	}
	field, _ := reflect.TypeFor[sheets.StoryEffect]().FieldByName("Kind")
	effects := strings.Split(field.Tag.Get("enum"), "|")
	if !slices.Equal(kit.Effects, effects) || !slices.Contains(kit.Effects, "nothing") {
		t.Fatalf("the kit's effects: %v", kit.Effects)
	}
	var templates []string
	for _, row := range r.book.Arcs {
		templates = append(templates, row.ID)
	}
	if !slices.Equal(kit.Templates, templates) || len(templates) == 0 {
		t.Fatalf("the kit's templates: %v", kit.Templates)
	}
	schema, err := os.ReadFile(filepath.Join(sheetfs.ModuleRoot(), "sheets", "schema", "story.arcs.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	if kit.Schema != string(schema) {
		t.Fatal("the kit's schema is not the checked-in one")
	}
	if kit.Season != ch.Season.N {
		t.Fatalf("the kit is for season %d, the world is in %d", kit.Season, ch.Season.N)
	}
}

// TestKindNameOverChat: the first maker of a kind sees it renamable and
// names it once over the action path; anyone else is refused.
func TestKindNameOverChat(t *testing.T) {
	r := start(t, io.Discard)
	ctx := context.Background()
	a, _ := founder(t, r, "c-admin", "u-admin", "srv-1")
	bRep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "c-b", DiscordID: "u-b", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	b := bRep.Character
	advance(t, ctx, r, 2)

	release := r.srv.Hold()
	g := r.srv.Game()
	c := g.Char(a.ID)
	var kind string
	for _, m := range g.Rules().Book.Materials {
		rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: m.ID, Qty: 2}}}
		ap, err := g.Appraise(c, rec)
		if err != nil {
			continue
		}
		for _, give := range []game.Command{
			{Key: "give-mat", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Material(m.ID), Units: 2, Note: "test"},
			{Key: "give-fee", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Coin, Units: ap.Fee, Note: "test"},
			{Key: "craft", Char: c.C.ID, Kind: game.Craft, Recipe: &rec},
		} {
			if _, err := g.Act(give); err != nil {
				t.Fatal(err)
			}
		}
		kind = c.C.Discovered[len(c.C.Discovered)-1]
		break
	}
	release()
	if kind == "" {
		t.Fatal("no kind was made")
	}

	known := func() api.Known {
		t.Helper()
		rs := read[api.Recipes](t, r, true, api.PathRecipes+"?characterId="+a.ID, 200)
		i := slices.IndexFunc(rs.Known, func(k api.Known) bool { return k.Kind == kind })
		if i < 0 {
			t.Fatalf("the maker does not know %s", kind)
		}
		return rs.Known[i]
	}
	if k := known(); !k.Renamable || !k.First {
		t.Fatalf("the first maker's kind: %+v", k)
	}
	name := func(key, who, text string) *api.Refusal {
		t.Helper()
		o, err := r.cli.Options(ctx, who)
		if err != nil {
			t.Fatal(err)
		}
		_, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: key, CharacterID: who, Version: o.Version, Kind: api.ActKindName, Option: kind, Note: text})
		if err != nil {
			t.Fatal(err)
		}
		return ref
	}
	if ref := name("kn-1", b.ID, "Not Mine"); ref == nil || ref.Code != api.CodeNotFirst {
		t.Fatalf("another naming: %+v", ref)
	}
	if ref := name("kn-2", a.ID, "Ash Hook"); ref != nil {
		t.Fatalf("the first maker's name: %+v", ref)
	}
	if k := known(); k.Renamable || k.Name != "Ash Hook" {
		t.Fatalf("the named kind: %+v", k)
	}
	if ref := name("kn-3", a.ID, "Again"); ref == nil || ref.Code != api.CodeNamed {
		t.Fatalf("a second naming: %+v", ref)
	}
}

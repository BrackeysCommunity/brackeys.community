package tags_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/tags"
)

func rules(t *testing.T) []tags.Rule {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := tags.Compile(b.Rules)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func set(note string, ts ...tags.Tag) tags.TagSet { return tags.Plain(tags.Source{Note: note}, ts...) }

func fired(why tags.Why) []string {
	var out []string
	for _, s := range why.Steps {
		out = append(out, s.Rule)
	}
	return out
}

// A storm over a marsh charges a mire stalker, and a conductive blade then
// bites: the band effect's why chain runs back through the storm's fact.
func TestChainedRulesCarryTheirWhy(t *testing.T) {
	rs := rules(t)
	stormFact := fact.ID(41)
	creature := set("creature:mire-stalker", "creature", "marsh-born", "wary")
	place := tags.Plain(tags.Source{Fact: stormFact}, "storm")
	effects, _ := tags.Apply(rs, creature, tags.Context{Place: place})
	if len(effects) != 1 {
		t.Fatalf("effects %v", effects)
	}
	add, ok := effects[0].(tags.AddTag)
	if !ok || add.Tag != "charged" || add.Target != tags.Subject {
		t.Fatalf("got %#v", effects[0])
	}
	// The blade meets the now-charged creature.
	charged := creature.Clone()
	charged.Add(tags.Held{Tag: "charged", From: tags.Source{Fact: 42, Note: "rule:storm-charges"}})
	blade := set("kind:copperleaf", "item", "metal", "conductive", "keen")
	effects, why := tags.Apply(rs, blade, tags.Context{Other: charged})
	if got := fired(why); !slices.Equal(got, []string{"conductive-bites"}) {
		t.Fatalf("fired %v", got)
	}
	if b := effects[0].(tags.Band); b.Steps != 1 {
		t.Fatalf("band %d", b.Steps)
	}
	if f := why.Facts(effects[0].Step()); !slices.Equal(f, []fact.ID{42}) {
		t.Fatalf("facts %v", f)
	}
}

// Within one Apply, a tag one rule adds completes another rule's pattern.
func TestOneApplyChains(t *testing.T) {
	rs := rules(t)
	// A dry thing beside something burning catches; nothing wet is near.
	subject := set("node:reed-bed", "node", "dry")
	other := tags.Plain(tags.Source{Fact: 7}, "burning")
	_, why := tags.Apply(rs, subject, tags.Context{Other: other})
	if got := fired(why); !slices.Equal(got, []string{"dry-catches"}) {
		t.Fatalf("fired %v", got)
	}
	// Now on a wet tile: it catches, then the wet douses it, and the douse
	// step names the catch step as its cause.
	effects, why := tags.Apply(rs, subject, tags.Context{Other: other, Place: set("weather", "wet")})
	if got := fired(why); !slices.Equal(got, []string{"dry-catches", "wet-douses"}) {
		t.Fatalf("fired %v", got)
	}
	last := effects[len(effects)-1]
	if rm, ok := last.(tags.RemoveTag); !ok || rm.Tag != "burning" {
		t.Fatalf("last effect %#v", last)
	}
	if c := why.Chain(last.Step()); !slices.Equal(c, []int{1, 2}) {
		t.Fatalf("chain %v", c)
	}
	if f := why.Facts(last.Step()); !slices.Equal(f, []fact.ID{7}) {
		t.Fatalf("facts %v", f)
	}
}

// Each starter and terrain rule fires on its own pattern, and only there.
func TestStarterRules(t *testing.T) {
	rs := rules(t)
	m := func(id string, v int64) tags.Measure {
		return tags.Measure{ID: id, Value: v, From: tags.Source{Fact: 9}}
	}
	cases := []struct {
		name    string
		subject tags.TagSet
		ctx     tags.Context
		want    []string
	}{
		{"storm", set("", "creature", "marsh-born"), tags.Context{Place: set("", "storm")}, []string{"storm-charges"}},
		{"no storm", set("", "creature", "marsh-born"), tags.Context{Place: set("", "clear")}, nil},
		{"fog hides", set("", "creature"), tags.Context{Place: set("", "fog")}, []string{"fog-hides"}},
		{"frost brittles", set("", "node", "wet"), tags.Context{Place: set("", "frost")}, []string{"frost-brittles"}},
		{"wooded ambush", set("", "creature"), tags.Context{Place: set("", "wooded")}, []string{"wooded-ambush"}},
		{"wooded reach", set("", "item", "reaching"), tags.Context{Place: set("", "wooded")}, []string{"wooded-reach"}},
		{"wet weighs", set("", "item", "heavy"), tags.Context{Place: set("", "wet")}, []string{"wet-weighs"}},
		{"heights", set("", "item"), tags.Context{Place: set("", "heights"), Other: set("", "creature")}, []string{"heights-favour"}},
		{"exposed", set("", "creature"), tags.Context{Place: set("", "exposed")}, []string{"exposed-no-ambush"}},
		{"keen bites", set("", "strike", "keen"), tags.Context{Other: set("", "creature")}, []string{"keen-bites"}},
		{"keen against thick", set("", "strike", "keen"), tags.Context{Other: set("", "thick")}, nil},
		{"warm", set("", "spell", "warm"), tags.Context{Other: set("", "brittle")}, []string{"warm-thaws"}},
		{"warm item is not a spell", set("", "item", "warm"), tags.Context{Other: set("", "brittle")}, nil},
		{"pack at 600", set("", "creature", "pack"), tags.Context{Measures: []tags.Measure{m("threat", 600)}}, []string{"packs-gather"}},
		{"pack at 599", set("", "creature", "pack"), tags.Context{Measures: []tags.Measure{m("threat", 599)}}, nil},
		{"wary party 3", set("", "creature", "wary"), tags.Context{Measures: []tags.Measure{m("party-size", 3)}}, []string{"wary-flees"}},
		{"mercantile", set("", "faction", "mercantile"), tags.Context{Measures: []tags.Measure{m("scarcity", 700)}}, []string{"scarcity-bids"}},
		{"corruption", set("", "node", "corrupted"), tags.Context{}, []string{"corruption-spoils"}},
		{"wet douses", set("", "creature", "burning", "wet"), tags.Context{}, []string{"wet-douses"}},
	}
	for _, c := range cases {
		_, why := tags.Apply(rs, c.subject, c.ctx)
		if got := fired(why); !slices.Equal(got, c.want) {
			t.Errorf("%s: fired %v, want %v", c.name, got, c.want)
		}
	}
	effects, _ := tags.Apply(rs, set("", "node", "corrupted"), tags.Context{})
	if len(effects) != 2 {
		t.Fatalf("corruption spoils: %v", effects)
	}
	if s := effects[1].(tags.Scale); s.Measure != "yield-value" || s.Percent != -50 {
		t.Fatalf("%#v", s)
	}
}

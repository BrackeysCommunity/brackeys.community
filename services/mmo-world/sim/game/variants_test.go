package game

import (
	"encoding/json"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// keenCut is a won press led by the edge with a keen blade: the style GDD
// 13.3 names, which a plated variant resists.
func keenCut() fight.Option {
	return fight.Option{ID: "test-cut", Axis: "edge", Tags: []tags.Tag{"edge-led"}, Gear: &fight.Gear{Tags: []tags.Tag{"keen"}}}
}

// nameStyle names a press's style in h's region by hand.
func nameStyle(t *testing.T, g *Game, h hex.Hex, o fight.Option) *emerge.StyleTrace {
	t.Helper()
	region := g.World.RegionAt(h)
	id, lead, resisted, ok := g.r.Emerge.Styles.StyleOf(o.Axis, o.Tags, o.Gear.Tags)
	if !ok || region < 0 {
		t.Fatalf("no style for %+v in region %d", o, region)
	}
	k := emerge.StyleKey{Region: region, Style: id}
	st := &emerge.StyleTrace{Key: k, Resisted: resisted, Lead: lead}
	g.Emergence.Styles[k] = st
	at := h
	p, err := g.promoteTrace(Promoting{Type: emerge.Style, Region: region, At: &at, Of: id})
	if err != nil {
		t.Fatal(err)
	}
	st.Done = p.ID
	return st
}

// wins sets a day's won beats with a style and in its region.
func wins(g *Game, st *emerge.StyleTrace, day, styled, all int64) {
	st.Today = emerge.Daily{N: styled, Day: day}
	g.regionTally(st.Key.Region).Today = emerge.Daily{N: all, Day: day}
}

// turn runs emergence's day turn for the day after day.
func turn(t *testing.T, g *Game, day int64) {
	t.Helper()
	if err := g.emergenceDay(dayTick(day + 1)); err != nil {
		t.Fatal(err)
	}
}

func TestAdaptationDaily(t *testing.T) {
	g := feedGame(t)
	p := g.r.Emerge.P
	h := openTiles(t, g, 1)[0]
	st := nameStyle(t, g, h, keenCut())
	// An unnamed style with the same share does not adapt.
	o := keenCut()
	o.Gear.Tags = []tags.Tag{tags.Tag(g.r.Book.Traits[0].Tag)}
	id, lead, resisted, _ := g.r.Emerge.Styles.StyleOf(o.Axis, o.Tags, o.Gear.Tags)
	other := &emerge.StyleTrace{Key: emerge.StyleKey{Region: st.Key.Region, Style: id}, Lead: lead, Resisted: resisted}
	g.Emergence.Styles[other.Key] = other

	steps := []struct {
		styled, all int64
		want        int64
	}{
		{7, 10, emerge.Adapted(0, 70, p)},
		{1, 10, emerge.Adapted(emerge.Adapted(0, 70, p), 10, p)},
		{0, 0, max(emerge.Adapted(emerge.Adapted(0, 70, p), 10, p)-p.AdaptFade, 0)},
	}
	for i, s := range steps {
		day := int64(i + 1)
		wins(g, st, day, s.styled, s.all)
		other.Today = emerge.Daily{N: s.styled, Day: day}
		turn(t, g, day)
		if st.Adapt != s.want {
			t.Fatalf("day %d: %d of %d wins left adaptation at %d, want %d", day, s.styled, s.all, st.Adapt, s.want)
		}
	}
	if st.Adapt <= 0 || st.Adapt >= emerge.Adapted(0, 70, p) {
		t.Fatalf("adaptation neither rose nor faded: %d", st.Adapt)
	}
	if other.Adapt != 0 {
		t.Fatalf("an unnamed style adapted to %d", other.Adapt)
	}
	// A day's wins before the one just ended count for nothing.
	at := st.Adapt
	wins(g, st, 2, 10, 10)
	turn(t, g, 4)
	if st.Adapt != max(at-p.AdaptFade, 0) {
		t.Fatalf("an old day's wins moved adaptation to %d", st.Adapt)
	}

	// Resistance starts at resist-at, against every creature there.
	arch := g.Creatures(h)[0]
	st.Adapt = p.ResistAt - 1
	if r := g.resistFor(st.Key.Region, arch, false); len(r) != 0 {
		t.Fatalf("resisting under resist-at: %v", r)
	}
	st.Adapt = p.ResistAt
	want := []fight.Resist{{Tag: tags.Tag(st.Resisted), Bands: p.ResistBands}}
	if r := g.resistFor(st.Key.Region, arch, false); !slices.Equal(r, want) {
		t.Fatalf("resist at %d: %v, want %v", st.Adapt, r, want)
	}
	c := feedChars(t, g, 1, h)[0]
	if err := g.begin(c, false, 0); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(c.Fight.E.Resist, want) {
		t.Fatalf("an encounter in the adapted region resists %v", c.Fight.E.Resist)
	}
	// Elsewhere nothing resists.
	if r := g.resistFor(st.Key.Region+1, arch, false); len(r) != 0 {
		t.Fatalf("another region resists %v", r)
	}
}

// marshTile is the nearest open marsh tile the wire-eel lives on, its
// region woken.
func marshTile(t *testing.T, g *Game) hex.Hex {
	t.Helper()
	for r := int64(1); r < 60; r++ {
		for _, h := range hex.Ring(g.SettlementHex(0), r) {
			if g.r.Gen.Baseline(h).Terrain != "marsh" || g.slot(h) != "" || !slices.Contains(g.Creatures(h), wireEel) {
				continue
			}
			if err := g.World.Discover(g.Log, h, fact.Ref{Kind: renownCharacter, ID: "test"}); err != nil {
				t.Fatal(err)
			}
			reachAt(t, g, h)
			if g.World.RegionAt(h) >= 0 {
				return h
			}
		}
	}
	t.Fatal("no marsh with wire-eels near the first settlement")
	return hex.Hex{}
}

// wireEel is GDD 13.3's creature, mire-stalker in the sheets.
const wireEel = "mire-stalker"

func TestVariantAt60(t *testing.T) {
	g := feedGame(t)
	p := g.r.Emerge.P
	percent := line(g, emerge.Variant).Percent
	h := marshTile(t, g)
	st := nameStyle(t, g, h, keenCut())
	st.Beaten = map[string]int64{"reed-rat": 3, wireEel: 5}
	// One short of the line.
	st.Adapt = percent - p.AdaptRate - 1
	wins(g, st, 1, 10, 10)
	turn(t, g, 1)
	if st.Adapt != percent-1 || st.Variant != "" || len(g.Emergence.Variants) != 0 {
		t.Fatalf("adaptation %d made a variant: %+v", st.Adapt, g.Emergence.Variants)
	}
	st.Adapt = percent - p.AdaptRate
	wins(g, st, 2, 10, 10)
	turn(t, g, 2)
	vs := promotionsOf(g, emerge.Variant)
	if st.Adapt != percent || len(vs) != 1 || st.Variant != vs[0].ID || len(g.Emergence.Variants) != 1 {
		t.Fatalf("adaptation %d made no variant: %+v", st.Adapt, vs)
	}
	v := g.Emergence.Variants[0]
	rows := emerge.Candidates(st.Resisted, st.Lead, g.r.Emerge.Adapt)
	if v.Archetype != wireEel || vs[0].Of != wireEel || !slices.Contains(rows, v.Row) || v.Style != st.Key.Style || v.Resisted != "keen" {
		t.Fatalf("the variant: %+v of %v", v, rows)
	}
	if v.Row != "plated" || vs[0].Name != "Plated wire-eel" {
		t.Fatalf("a keen style's variant is %s, %q", v.Row, vs[0].Name)
	}
	f, _ := g.Log.Get(vs[0].Fact)
	if datumOf(f.Data, datumResists) != "keen" || datumOf(f.Data, datumMaterial) != v.Material || datumOf(f.Data, "of") != wireEel {
		t.Fatalf("the variant's fact: %+v", f.Data)
	}
	// Its first drop becomes a found material, promoted after it.
	ms := promotionsOf(g, emerge.Material)
	base := sheets.Lookup(g.r.Book.Materials)["stalker-hide"]
	want, _ := g.r.Emerge.Found(*base, "plated")
	mi := slices.IndexFunc(g.Emergence.Materials, func(m sheets.Material) bool { return m.ID == v.Material })
	ok := mi >= 0
	var got sheets.Material
	if ok {
		got = g.Emergence.Materials[mi]
	}
	if !ok || len(ms) != 1 || ms[0].Of != v.Material || v.Material != want.ID || !g.knownMaterial(v.Material) {
		t.Fatalf("the variant's material: %q %+v, promotions %+v", v.Material, got, ms)
	}
	if got.Tier != 2 || got.Vector.Ward != 52 || got.Vector.Flex != 16 || ms[0].Name != "Plated hide" {
		t.Fatalf("plated hide: %+v named %q", got, ms[0].Name)
	}
	// A variant is made once; another region's of the same row and drop
	// makes no second material.
	wins(g, st, 3, 10, 10)
	turn(t, g, 3)
	if len(promotionsOf(g, emerge.Variant)) != 1 {
		t.Fatal("a second variant of one style")
	}
	far := openTiles(t, g, 40)
	i := slices.IndexFunc(far, func(x hex.Hex) bool { return g.World.RegionAt(x) != st.Key.Region })
	if i < 0 {
		t.Skip("one region near the first settlement")
	}
	two := nameStyle(t, g, far[i], keenCut())
	two.Beaten = map[string]int64{wireEel: 1}
	two.Adapt = percent
	wins(g, two, 4, 1, 1)
	turn(t, g, 4)
	if len(promotionsOf(g, emerge.Variant)) != 2 || len(promotionsOf(g, emerge.Material)) != 1 || len(g.Emergence.Materials) != 1 {
		t.Fatalf("a second region's variant: %d variants, %d materials", len(promotionsOf(g, emerge.Variant)), len(promotionsOf(g, emerge.Material)))
	}
	// The second region names the style as the world first did.
	if ss := promotionsOf(g, emerge.Style); ss[0].Name != ss[1].Name {
		t.Fatalf("one style named twice: %q, %q", ss[0].Name, ss[1].Name)
	}
}

// variantWorld is a marsh whose keen style has adapted to the variant
// line; with made, its wire-eels' variant stands.
func variantWorld(t *testing.T, made bool) (*Game, hex.Hex, *emerge.StyleTrace) {
	t.Helper()
	g := feedGame(t)
	h := marshTile(t, g)
	st := nameStyle(t, g, h, keenCut())
	st.Beaten = map[string]int64{wireEel: 1}
	st.Adapt = line(g, emerge.Variant).Percent
	if made {
		if err := g.makeVariant(st); err != nil {
			t.Fatal(err)
		}
	}
	return g, h, st
}

// encounterEnd is the fact an encounter's end writes, as a press logs it.
func encounterEnd(t *testing.T, g *Game, c *Char, h hex.Hex, arch string) fact.Fact {
	t.Helper()
	f, err := g.r.weights.New(g.Tick(), "encounter."+fight.Won, "", []fact.Ref{charRefOf(c), {Kind: "archetype", ID: arch}},
		nil, append(fact.At(h), fact.S(datumArchetype, arch))...)
	if err != nil {
		t.Fatal(err)
	}
	if f.ID, err = g.Log.Append(f); err != nil {
		t.Fatal(err)
	}
	return f
}

func charRefOf(c *Char) fact.Ref { return fact.Ref{Kind: renownCharacter, ID: c.C.ID} }

func TestVariantSpawnsAndDrops(t *testing.T) {
	g, h, st := variantWorld(t, true)
	plain, _, _ := variantWorld(t, false)
	v := g.Emergence.Variants[0]
	p := g.r.Emerge.P
	c := feedChars(t, g, 1, h)[0]
	pc := feedChars(t, plain, 1, h)[0]
	var variants, eels int
	var dropped *fight.Encounter
	for range 60 {
		if err := g.begin(c, false, 0); err != nil {
			t.Fatal(err)
		}
		if err := plain.begin(pc, false, 0); err != nil {
			t.Fatal(err)
		}
		e, pe := c.Fight.E, pc.Fight.E
		c.Fight, pc.Fight = nil, nil
		a, _ := json.Marshal(e)
		b, _ := json.Marshal(pe)
		_, is := g.VariantAt(h, e.Creature)
		if e.Creature.Archetype == wireEel {
			eels++
		}
		if !is {
			if string(a) != string(b) {
				t.Fatalf("an encounter that is no variant moved:\n%s\n%s", a, b)
			}
			continue
		}
		variants++
		dropped = e
		if e.Creature.Archetype != wireEel || e.Creature.Drops[0] != v.Material || !slices.Contains(e.Creature.Tags, tags.Tag(v.Row)) {
			t.Fatalf("the variant: %+v", e.Creature)
		}
		if slices.Contains(pe.Creature.Tags, tags.Tag(v.Row)) || pe.Creature.Drops[0] == v.Material {
			t.Fatalf("without a variant the same encounter is %+v", pe.Creature)
		}
		want := []fight.Resist{{Tag: tags.Tag(st.Resisted), Bands: p.VariantResistBands}}
		if !slices.Equal(e.Resist, want) {
			t.Fatalf("the variant resists %v, want %v", e.Resist, want)
		}
	}
	if variants == 0 || variants == eels {
		t.Fatalf("%d of %d wire-eels were the variant at %d%%", variants, eels, p.VariantShare)
	}

	// Its haul holds the found material, and its first looter is named.
	c.Fight = &Fight{E: dropped}
	from := fact.ID(g.Log.Len())
	endFight(t, g, c, fight.Won, []item.Spoil{{Material: v.Material, Qty: 2}})
	if g.Ledger.Of(ledger.Char(c.C.ID), ledger.Material(v.Material)) != 2 {
		t.Fatal("the variant's haul was not received")
	}
	audit(t, g)
	mustFeed(t, g.noteTraces(append(g.Log.Since(from), encounterEnd(t, g, c, h, wireEel))))
	looted := func() []fact.Fact {
		var out []fact.Fact
		for _, f := range g.Log.Since(from) {
			if f.Kind == factLootedFirst {
				out = append(out, f)
			}
		}
		return out
	}
	lf := looted()
	if len(lf) != 1 || datumOf(lf[0].Data, datumMaterial) != v.Material || lf[0].Subjects[0].ID != c.C.ID {
		t.Fatalf("the first loot: %+v", lf)
	}
	if g.Emergence.Promotion(v.ID).First != c.C.ID || g.materialPromotion(v.Material).First != c.C.ID {
		t.Fatal("the first looter is not the variant's and material's first")
	}
	// A second loot names nobody.
	other := feedChars(t, g, 1, h)[0]
	dirGive(t, g, other, ledger.Material(v.Material), 1)
	mustFeed(t, g.noteTraces([]fact.Fact{encounterEnd(t, g, other, h, wireEel)}))
	if len(looted()) != 1 {
		t.Fatal("a second loot was a first")
	}
}

// TestPlatedEelLoop is GDD 13.3 by hand: a keen style named in the marsh,
// the region adapts, the plated wire-eel appears, drops plated hide, and a
// kind nobody has made is made of it.
func TestPlatedEelLoop(t *testing.T) {
	g := feedGame(t)
	ln := line(g, emerge.Style)
	h := marshTile(t, g)
	region := g.World.RegionAt(h)
	cs := feedChars(t, g, int(ln.Distinct), h)
	eel := &fight.Encounter{Creature: fight.Creature{Archetype: wireEel}}
	o := keenCut()
	day := int64(1)
	for _, c := range cs {
		for range ln.PerCharacter {
			mustFeed(t, g.noteReliance(c, eel, o, dayTick(day)))
		}
	}
	styles := promotionsOf(g, emerge.Style)
	if len(styles) != 1 || styles[0].Region != region || styles[0].Of != "edge+keen" {
		t.Fatalf("no keen style in the marsh: %+v", styles)
	}
	for ; day < 30 && len(g.Emergence.Variants) == 0; day++ {
		for _, c := range cs[:2] {
			mustFeed(t, g.noteReliance(c, eel, o, dayTick(day)))
		}
		turn(t, g, day)
	}
	vs := promotionsOf(g, emerge.Variant)
	if len(vs) != 1 || vs[0].Name != "Plated wire-eel" || vs[0].Region != region {
		t.Fatalf("no plated wire-eel by day %d: %+v", day, vs)
	}
	v := g.Emergence.Variants[0]
	var m sheets.Material
	if i := slices.IndexFunc(g.Emergence.Materials, func(m sheets.Material) bool { return m.ID == v.Material }); i >= 0 {
		m = g.Emergence.Materials[i]
	}
	if v.Material != "found.plated.stalker-hide" || m.Tier != 2 || m.Vector.Ward != 52 || m.Vector.Flex != 16 {
		t.Fatalf("plated hide: %+v", m)
	}

	// Meet it, beat it, carry its hide home.
	c := cs[0]
	var e *fight.Encounter
	for range 200 {
		if err := g.begin(c, false, 0); err != nil {
			t.Fatal(err)
		}
		if _, is := g.VariantAt(h, c.Fight.E.Creature); is {
			e = c.Fight.E
			break
		}
		c.Fight = nil
	}
	if e == nil {
		t.Fatal("the marsh never sent its plated wire-eel")
	}
	if !slices.Contains(e.Resist, fight.Resist{Tag: "keen", Bands: g.r.Emerge.P.VariantResistBands}) {
		t.Fatalf("the plated wire-eel does not resist keen: %v", e.Resist)
	}
	from := fact.ID(g.Log.Len())
	endFight(t, g, c, fight.Won, []item.Spoil{{Material: v.Material, Qty: 2}})
	mustFeed(t, g.noteTraces([]fact.Fact{encounterEnd(t, g, c, h, wireEel)}))
	if !slices.ContainsFunc(g.Log.Since(from), func(f fact.Fact) bool { return f.Kind == factLootedFirst }) {
		t.Fatal("plated hide's first loot went unnamed")
	}
	c.C.At = g.SettlementHex(0)
	rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: v.Material, Qty: 2}}}
	ap, err := g.Appraise(c, rec)
	if err != nil {
		t.Fatal(err)
	}
	dirGive(t, g, c, ledger.Coin, ap.Fee)
	res, err := g.Act(Command{Key: "plated-craft", Char: c.C.ID, Kind: Craft, Recipe: &rec})
	if err != nil {
		t.Fatal(err)
	}
	var kind string
	for _, f := range res.Facts {
		if f.Kind == factKindDiscovered {
			kind = datumOf(f.Data, "kind")
		}
	}
	k, ok := g.Kinds.Kind(c.C.Discovered[len(c.C.Discovered)-1])
	if !ok || !slices.ContainsFunc(k.Recipe.Inputs, func(in item.Input) bool { return in.Kind == v.Material }) {
		t.Fatalf("no kind made of plated hide (discovered %q): %+v", kind, k)
	}
	if g.Ledger.Of(ledger.Char(c.C.ID), ledger.Material(v.Material)) != 0 {
		t.Fatal("the craft did not take the plated hide")
	}
	audit(t, g)
}

func TestFoundMaterialPricedAndListed(t *testing.T) {
	g := feedGame(t)
	base := sheets.Lookup(g.r.Book.Materials)["stalker-hide"]
	m, _ := g.r.Emerge.Found(*base, "plated")
	if g.isMaterial(ledger.Material(m.ID)) || g.tradable(m.ID) {
		t.Fatal("a material is known before it is found")
	}
	if !g.foundMaterial(m) || g.foundMaterial(m) {
		t.Fatal("a found material registers once")
	}
	if !g.isMaterial(ledger.Material(m.ID)) || !g.tradable(m.ID) {
		t.Fatal("a found material is no material")
	}
	if v := g.r.Values.Asset(m.ID); v <= g.r.Values.Asset(base.ID) {
		t.Fatalf("plated hide is worth %d, treated hide %d", v, g.r.Values.Asset(base.ID))
	}
	if id, ok := g.MaterialOfTag("plated"); !ok || id != m.ID {
		t.Fatalf("the material of plated: %q", id)
	}
	if g.tagValue("plated") != g.r.Values.Asset(m.ID) || g.tagValue("hide") != g.r.Values.Asset("hide-scraps") {
		t.Fatalf("tag values: plated %d, hide %d", g.tagValue("plated"), g.tagValue("hide"))
	}
	if !slices.ContainsFunc(g.r.Values.Wants(nil), func(w econ.Want) bool { return w.Material == m.ID && w.Price > 0 }) {
		t.Fatal("no order wants plated hide")
	}
	// A book lists it.
	c := mustCreate(t, g, "plated-seller", "knife")
	c.C.At = g.SettlementHex(0)
	dirGive(t, g, c, ledger.Material(m.ID), 3)
	if _, err := g.Act(Command{Key: "plated-ask", Char: c.C.ID, Kind: Ask, Material: m.ID, Units: 3, Price: g.r.Values.Asset(m.ID)}); err != nil {
		t.Fatal(err)
	}
	b := g.BookOf(0, m.ID)
	if b == nil || len(b.Asks) != 1 || b.Asks[0].Qty != 3 {
		t.Fatalf("the book of plated hide: %+v", b)
	}
	audit(t, g)
	// Saved and loaded, it is still a material.
	g2 := reload(t, g)
	if !g2.isMaterial(ledger.Material(m.ID)) || g2.r.Values.Asset(m.ID) != g.r.Values.Asset(m.ID) {
		t.Fatal("a found material did not survive a reload")
	}
}

// A goal legend's archetype meets its region carrying the legend's trait;
// laid to rest, or elsewhere, it carries nothing.
func TestVariantsLegendTraitTag(t *testing.T) {
	g := feedGame(t)
	h := openTiles(t, g, 1)[0]
	region := g.World.RegionAt(h)
	kinds := g.Creatures(h)
	arch := kinds[0]
	trait := g.r.Book.LegendTraits[0]
	l := &emerge.LegendRec{ID: "legend:1", Trait: trait.ID, Of: fact.Ref{Kind: kindCreature, ID: arch}, Region: region, At: h}
	g.Emergence.Legends = append(g.Emergence.Legends, l)
	if tag, ok := g.legendTag(region, arch); !ok || tag != tags.Tag(trait.Tag) {
		t.Fatalf("the legend's tag: %q", tag)
	}
	if _, ok := g.legendTag(region+1, arch); ok {
		t.Fatal("a legend tagged another region")
	}
	c := feedChars(t, g, 1, h)[0]
	var met, others bool
	for range 40 {
		if err := g.begin(c, false, 0); err != nil {
			t.Fatal(err)
		}
		cr := c.Fight.E.Creature
		c.Fight = nil
		base := g.r.Fight.Spawn(cr.Archetype, nil, nil, nil)
		has := slices.Contains(cr.Tags, tags.Tag(trait.Tag)) && !slices.Contains(base.Tags, tags.Tag(trait.Tag))
		switch {
		case cr.Archetype == arch:
			met = true
			if !slices.Contains(cr.Tags, tags.Tag(trait.Tag)) {
				t.Fatalf("the legend's %s carries no %s: %v", arch, trait.Tag, cr.Tags)
			}
		case has:
			t.Fatalf("%s carries the legend's %s", cr.Archetype, trait.Tag)
		default:
			others = true
		}
	}
	if !met || (len(kinds) > 1 && !others) {
		t.Fatalf("met the legend %v, others %v", met, others)
	}
	l.Laid = 1
	if _, ok := g.legendTag(region, arch); ok {
		t.Fatal("a legend laid to rest still tags its creature")
	}
}

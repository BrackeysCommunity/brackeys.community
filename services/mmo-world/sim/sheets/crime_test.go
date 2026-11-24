package sheets_test

import (
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/sheets"
)

// The theft and alignment sheets hold the cells GDD 5.10, 6.5 and 4.5 set.
func TestCrimeSheets(t *testing.T) {
	b := live(t)
	if len(b.AlignBands) != 5 || len(b.AlignActs) != 9 || len(b.TheftKinds) != 4 || len(b.Leanings) != 8 || len(b.BandShifts) != 3 {
		t.Fatalf("%d bands, %d acts, %d theft kinds, %d leanings, %d band shifts",
			len(b.AlignBands), len(b.AlignActs), len(b.TheftKinds), len(b.Leanings), len(b.BandShifts))
	}
	for _, c := range []struct {
		rows []sheets.Param
		id   string
		want int64
	}{
		{b.AlignParams, "min", -100}, {b.AlignParams, "max", 100}, {b.AlignParams, "depth", 125},
		{b.AlignParams, "good-day", 6}, {b.AlignParams, "pair-day", 2}, {b.AlignParams, "known-kept", 16},
		{b.AlignParams, "know-days", 14}, {b.AlignParams, "goal-reward-least", 10},
		{b.TheftParams, "witness-upright", 10}, {b.TheftParams, "witness-sleight", 3}, {b.TheftParams, "witness-cover", 5},
		{b.TheftParams, "witness-quiet", 15}, {b.TheftParams, "witness-least", 5}, {b.TheftParams, "witness-most", 95},
		{b.TheftParams, "standing-coin", 10}, {b.TheftParams, "standing-least", 3}, {b.TheftParams, "hot-days", 7},
		{b.TheftParams, "hot-reach", 12}, {b.TheftParams, "wanted-days", 3}, {b.TheftParams, "store-kept", 30},
		{b.TheftParams, "betray-at", 25}, {b.TheftParams, "betrayal-standing", -50}, {b.TheftParams, "grudge-days", 60},
		{b.TheftParams, "prey-share", 100}, {b.TheftParams, "walls-burglaries", 5}, {b.TheftParams, "walls-days", 7},
		{b.SyndicateParams, "fence-pays", 60}, {b.SyndicateParams, "back-room-pays", 70}, {b.SyndicateParams, "fence-standing-coin", 25},
		{b.SyndicateParams, "launder-percent", 10}, {b.SyndicateParams, "launder-standing-coin", 50}, {b.SyndicateParams, "gate", 25},
		{b.SyndicateParams, "trusted", 50}, {b.SyndicateParams, "invite-again-days", 14}, {b.SyndicateParams, "dens-per-captain", 4},
		{b.SyndicateParams, "job-share", 5}, {b.SyndicateParams, "job-worth", 40}, {b.SyndicateParams, "job-standing", 5},
		{b.SyndicateParams, "job-days", 1}, {b.SyndicateParams, "job-reach", 12}, {b.SyndicateParams, "informer-reach", 12},
		{b.SyndicateParams, "informer-rest-days", 14},
		{b.NPCParams, "disposition-warm", 20}, {b.NPCParams, "disposition-cold", -20}, {b.NPCParams, "disposition-hostile", -40},
		{b.NPCParams, "grudge-disposition", -40}, {b.NPCParams, "disposition-price", 5}, {b.NPCParams, "robbed-disposition", -20},
		{b.NPCParams, "robbed-decay", 50},
	} {
		if got := sheets.IntParam(c.rows, c.id); got != c.want {
			t.Errorf("%s is %d, want %d", c.id, got, c.want)
		}
	}
	if len(b.AlignParams) != 8 || len(b.TheftParams) != 18 || len(b.SyndicateParams) != 16 {
		t.Errorf("%d alignment, %d theft, %d syndicate cells", len(b.AlignParams), len(b.TheftParams), len(b.SyndicateParams))
	}

	kinds := sheets.Lookup(b.TheftKinds)
	for id, want := range map[string][]string{
		"lift": {"slip"}, "burgle": {"lock", "slip"}, "waylay": {"clash", "clash", "clash"}, "flee": {"chase", "chase"},
	} {
		if got := kinds[id].BeatIDs(); !slices.Equal(got, want) {
			t.Errorf("theft.kinds %s beats %v, want %v", id, got, want)
		}
	}
	if k := kinds["waylay"]; !k.Always || k.Witness != 100 || k.Share != 25 {
		t.Errorf("waylay %+v", k)
	}
	if k := kinds["lift"]; k.Witness != 40 || k.WitnessOut != 15 || k.Coin != 20 || k.CoinPerSleight != 4 {
		t.Errorf("lift %+v", k)
	}

	shifts := sheets.Lookup(b.BandShifts)
	if s := shifts[sheets.LeanUpright]; s.Shift("notorious") != -30 || s.Shift("upright") != 20 || s.Shift("no-band") != 0 {
		t.Errorf("upright shifts %+v", s)
	}
	if s := shifts[sheets.LeanCrooked]; s.Shift("notorious") != 20 || s.Shift("decent") != -5 {
		t.Errorf("crooked shifts %+v", s)
	}

	arch := sheets.Lookup(b.Archetypes)
	if a := arch["syndicate"]; a == nil || !a.Seatless || a.Goal != "profit" || len(a.Buys) != 0 || len(a.Tends) != 0 {
		t.Errorf("syndicate archetype %+v", a)
	}
	if b.Archetypes[len(b.Archetypes)-1].ID != "syndicate" {
		t.Error("the syndicate archetype is not the last row")
	}
	roles := sheets.Lookup(b.NPCRoles)
	if roles["settlement-watch"].Leaning != "watch" || roles["den-fence"].Place != "den" || roles["syndicate-captain"].Place != "syndicate" {
		t.Errorf("roles: watch %+v, fence %+v", roles["settlement-watch"], roles["den-fence"])
	}
	inv := slices.IndexFunc(b.Arcs, func(a sheets.ArcRow) bool { return a.ID == "the-invitation" })
	inf := slices.IndexFunc(b.Arcs, func(a sheets.ArcRow) bool { return a.ID == "the-informer" })
	if inv != len(b.Arcs)-2 || inf != len(b.Arcs)-1 || !b.Arcs[inv].Syndicate || b.Arcs[inf].Syndicate {
		t.Errorf("the invitation at %d, the informer at %d of %d arcs", inv, inf, len(b.Arcs))
	}
	if b.Troubles[len(b.Troubles)-1].ID != "thief-in-walls" {
		t.Error("thief-in-walls is not the last trouble")
	}
}

// Leaning rows never enter a trait draw: a pick over the sheet with them
// takes what a pick over the pool takes, whichever weights it is given.
func TestTraitPoolIgnoresLeanings(t *testing.T) {
	b := live(t)
	pool := sheets.TraitPool(b.NPCTraits)
	if len(pool) != len(b.NPCTraits)-2 || slices.ContainsFunc(pool, func(r sheets.NPCTrait) bool { return r.Leaning }) {
		t.Fatalf("pool of %d from %d rows", len(pool), len(b.NPCTraits))
	}
	without := slices.DeleteFunc(slices.Clone(b.NPCTraits), func(r sheets.NPCTrait) bool { return r.Leaning })
	if len(sheets.TraitPool(without)) != len(without) {
		t.Fatal("a pool without leanings changed")
	}
	d := draw.NewDrawer(draw.Key{1})
	for i := range 500 {
		who := draw.Int(int64(i))
		poolW := make([]int64, len(pool))
		allW := make([]int64, len(b.NPCTraits))
		for j := range poolW {
			poolW[j] = int64(d.Below(50, "test.weight", who, draw.Int(int64(j))))
		}
		k := 0
		for j, r := range b.NPCTraits {
			if r.Leaning {
				allW[j] = 99
				continue
			}
			allW[j] = poolW[k]
			k++
		}
		for _, c := range []struct {
			name    string
			w, base []int64
		}{{"sheet-length", allW, poolW}, {"pool-length", poolW, poolW}, {"even", nil, nil}} {
			got := sheets.PickTraits(b.NPCTraits, c.w, 2, d.Stream("test.pick", who).Pick)
			want := sheets.PickTraits(without, c.base, 2, d.Stream("test.pick", who).Pick)
			if !slices.Equal(got, want) {
				t.Fatalf("%s pick %d: %v, want %v", c.name, i, got, want)
			}
		}
	}
}

// The crime sheets are held to each other and to the archetypes.
func TestCrimeValidation(t *testing.T) {
	arc := func(b *sheets.Book, id string) *sheets.ArcRow {
		return &b.Arcs[slices.IndexFunc(b.Arcs, func(r sheets.ArcRow) bool { return r.ID == id })]
	}
	arch := func(b *sheets.Book, id string) *sheets.Archetype {
		return &b.Archetypes[slices.IndexFunc(b.Archetypes, func(r sheets.Archetype) bool { return r.ID == id })]
	}
	for _, c := range []struct {
		name, want string
		edit       func(*sheets.Book)
	}{
		{"a gap between bands", "alignment.bands crooked: bands run on from min without a gap", func(b *sheets.Book) {
			b.AlignBands[1].From--
		}},
		{"bands short of max", "alignment.bands: the last band ends on max", func(b *sheets.Book) {
			b.AlignBands[4].To--
		}},
		{"bands out of the shifts' order", "npcs.band-shifts: its columns are the alignment.bands rows", func(b *sheets.Book) {
			b.AlignBands[0].ID, b.AlignBands[1].ID = b.AlignBands[1].ID, b.AlignBands[0].ID
		}},
		{"a shallow depth", "alignment.params depth", func(b *sheets.Book) {
			b.AlignParams[slices.IndexFunc(b.AlignParams, func(p sheets.Param) bool { return p.ID == "depth" })].Value = b.AlignParams[1].Value
		}},
		{"a paired act with no partner", "alignment.acts goal-met: a paired act names its partner", func(b *sheets.Book) {
			b.AlignActs[slices.IndexFunc(b.AlignActs, func(a sheets.AlignAct) bool { return a.ID == "goal-met" })].Partner = ""
		}},
		{"a theft with no beat", "theft.kinds lift: a theft has at least one beat", func(b *sheets.Book) {
			b.TheftKinds[0].Beats = nil
		}},
		{"a theft beat that is not a beat", `theft.kinds lift.beats[0].beat: "sneak" is not an id in fights.beats`, func(b *sheets.Book) {
			b.TheftKinds[0].Beats[0].Beat = "sneak"
		}},
		{"an always theft under 100", "theft.kinds waylay: always witnessed", func(b *sheets.Book) {
			b.TheftKinds[slices.IndexFunc(b.TheftKinds, func(k sheets.TheftKind) bool { return k.ID == "waylay" })].Witness = 90
		}},
		{"leanings over 100", "npcs.leanings compact: upright and crooked together are at most 100", func(b *sheets.Book) {
			b.Leanings[slices.IndexFunc(b.Leanings, func(l sheets.Leaning) bool { return l.ID == "compact" })].Upright = 60
		}},
		{"an archetype without a leaning", "npcs.leanings: no row for archetype clans", func(b *sheets.Book) {
			b.Leanings = slices.DeleteFunc(b.Leanings, func(l sheets.Leaning) bool { return l.ID == "clans" })
		}},
		{"a role leaning that is no row", `npcs.roles settlement-watch.leaning: "guards" is not an id in npcs.leanings`, func(b *sheets.Book) {
			b.NPCRoles[slices.IndexFunc(b.NPCRoles, func(r sheets.NPCRole) bool { return r.ID == "settlement-watch" })].Leaning = "guards"
		}},
		{"a seatless archetype with a city", "story.faction-cities: seatless archetype syndicate holds no city", func(b *sheets.Book) {
			b.FactionCities = append(b.FactionCities, sheets.FactionCityRow{ID: "syndicate", Station: b.FactionCities[0].Station, Name: "Back room", Effect: b.FactionCities[0].Effect})
		}},
		{"a seatless archetype with moves", "factions.move-weights: seatless archetype syndicate makes no moves", func(b *sheets.Book) {
			mw := b.MoveWeights[0]
			mw.ID, mw.Archetype = "syndicate-"+mw.Move, "syndicate"
			b.MoveWeights = append(b.MoveWeights, mw)
		}},
		{"nothing seated", "factions.archetypes: the horizon seats at least one archetype", func(b *sheets.Book) {
			for i := range b.Archetypes {
				b.Archetypes[i].Seatless = true
				b.Archetypes[i].Tends = nil
			}
			b.FactionCities = nil
			b.MoveWeights = nil
		}},
		{"made outside a syndicate row", "the-invitation the-invitation take-the-job won[0]: made acts on a character, in a syndicate row", func(b *sheets.Book) {
			arc(b, "the-invitation").Syndicate = false
		}},
		{"informing on a character", "the-informer the-informer name-the-fence won[0]: inform acts on the den's settlement", func(b *sheets.Book) {
			arc(b, "the-informer").Stages[0].Sides[0].Won[0].Role = "character"
		}},
		{"a word to a settlement", "the-informer the-informer keep-quiet: a word is said to the NPC cast at at", func(b *sheets.Book) {
			arc(b, "the-informer").Stages[0].Sides[1].At = "seat"
		}},
		{"a trouble that makes", "story.troubles thief-in-walls: made belongs to an arc's cast", func(b *sheets.Book) {
			tr := &b.Troubles[len(b.Troubles)-1]
			tr.Held = append(tr.Held, sheets.StoryEffect{Kind: "made"})
		}},
		{"a leaning trait drawn as a content weight", `map.content-weights`, func(b *sheets.Book) {
			for i := range b.ContentWeights {
				if b.ContentWeights[i].Table == "trait" {
					b.ContentWeights[i].Row = "crooked"
					return
				}
			}
			t.Skip("no trait content weight to edit")
		}},
		{"a seatless archetype that tends", "factions.archetypes syndicate: a seatless archetype tends to no move", func(b *sheets.Book) {
			arch(b, "syndicate").Tends = []string{"trade"}
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			b := live(t)
			c.edit(b)
			err := b.Validate()
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Errorf("want %q, got %v", c.want, err)
			}
		})
	}
}

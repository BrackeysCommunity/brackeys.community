package emerge

import (
	"testing"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/sheets"
)

func testNames() *PackNames {
	names := map[string]string{
		"creatures.variants:plated":         "Plated",
		"creatures.archetypes:mire-stalker": "Wire-eel",
		"items.pairings:edge-and-ember":     "Edge-and-ember",
	}
	return NewPackNames([]sheets.NamePart{
		{ID: "road-word-road", List: ListRoadWord, Text: "Road"},
		{ID: "road-word-track", List: ListRoadWord, Text: "Track"},
		{ID: "style-lead-edge", List: ListStyleLead, Text: "Edge"},
		{ID: "style-word-keen", List: ListStyleWord, Text: "whet"},
		{ID: "material-noun-hide", List: ListMaterialNoun, Text: "hide"},
		{ID: "legend-epithet-old", List: ListLegendEpithet, Text: "Old"},
		{ID: "custom-word-bring", List: ListCustomWord, Text: "Haul"},
		{ID: "camp-word-camp", List: ListCampWord, Text: "Camp"},
		{ID: "haunt-word-barrow", List: ListHauntWord, Text: "Barrow"},
	}, func(ref string) string { return names[ref] })
}

func TestNames(t *testing.T) {
	n := testNames()
	d := draw.NewDrawer(draw.Key{1})
	hide := sheets.Material{ID: "stalker-hide", Tags: []string{"hide"}}
	for _, c := range []struct{ got, want string }{
		{VariantName(n, "plated", "mire-stalker"), "Plated wire-eel"},
		{MaterialName(n, "plated", hide), "Plated hide"},
		{StyleName(n, "edge-and-ember", "edge", "edge-and-ember"), "Edge-and-ember"},
		{StyleName(n, "edge+keen", "edge", "keen"), "Edge-and-whet"},
		{StyleName(n, "edge+keen", "edge-led", ""), "Edge-and-whet"},
		{RouteName("Ashford", "Kell"), "Ashford–Kell"},
		{CustomName("Ashford", "bring", n), "the Ashford Haul"},
		{LegendName(n, d, "Wire-eel", "legend:3"), "Wire-eel the Old"},
		{SiteName(n, d, Camp, "Den", "1,2"), "the Den Camp"},
		{SiteName(n, d, Haunt, "Den", "1,2"), "the Den Barrow"},
	} {
		if c.got != c.want {
			t.Errorf("%q, want %q", c.got, c.want)
		}
	}
	a := RoadName(n, d, "Ashford", "3,4")
	if a != RoadName(n, draw.NewDrawer(draw.Key{1}), "Ashford", "3,4") {
		t.Error("a road's name is not a function of its key")
	}
	if a != "the Ashford Road" && a != "the Ashford Track" {
		t.Errorf("road name %q", a)
	}
	if got := RoadName(NewPackNames(nil, nil), d, "Ashford", "3,4"); got != "the Ashford road" {
		t.Errorf("no parts: %q", got)
	}
}

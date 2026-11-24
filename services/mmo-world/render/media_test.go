package render_test

import (
	"bytes"
	"encoding/json"
	"image/color"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/sim/sheets"
)

func kit(t *testing.T) *render.Kit {
	t.Helper()
	k, err := render.DefaultKit()
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func pngOf(t *testing.T, name string, c *render.Canvas) []byte {
	t.Helper()
	b, err := c.PNG()
	if err != nil || len(b) == 0 {
		t.Fatal(name, err)
	}
	if dir := os.Getenv("RENDER_OUT"); dir != "" {
		if err := os.WriteFile(filepath.Join(dir, name+".png"), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return b
}

func keyOf(t *testing.T, kind string, in any) string {
	t.Helper()
	body, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	return render.Key(kind, body)
}

// TestPortrait: every archetype draws, alike for alike input and apart
// from the others; its key moves with the kit's digest, and a portrait is
// never drawn with another kit than its key names.
func TestPortrait(t *testing.T) {
	b, k := testkit.Book(t), kit(t)
	seen := map[string]string{}
	for _, cr := range b.Creatures {
		in := k.PortraitInput(cr.ID, cr.Tier, cr.Tags, "", nil)
		c, err := render.Portrait(in, k, b.Palette)
		if err != nil {
			t.Fatal(cr.ID, err)
		}
		png := pngOf(t, "portrait-"+cr.ID, c)
		again, err := render.Portrait(in, k, b.Palette)
		if err != nil || !bytes.Equal(png, pngOf(t, "portrait-"+cr.ID, again)) {
			t.Fatalf("%s: the same input drew twice differently", cr.ID)
		}
		if other, ok := seen[string(png)]; ok {
			t.Fatalf("%s draws as %s does", cr.ID, other)
		}
		seen[string(png)] = cr.ID
	}
	cr := b.Creatures[0]
	plain := k.PortraitInput(cr.ID, cr.Tier, cr.Tags, "", nil)
	marked := k.PortraitInput(cr.ID, cr.Tier, append(slices.Clone(cr.Tags), "plated", "no-layer-reads-this"), "plated", []string{"strike", "edge-led"})
	if slices.Contains(marked.Tags, "no-layer-reads-this") || marked.Resists != "edge-led,strike" || marked.Kit != k.Digest {
		t.Fatalf("portrait input %+v", marked)
	}
	a, _ := render.Portrait(plain, k, b.Palette)
	m, err := render.Portrait(marked, k, b.Palette)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(pngOf(t, "portrait-plain", a), pngOf(t, "portrait-variant-resisting", m)) {
		t.Fatal("a variant that resists draws as the plain creature")
	}
	moved := *k
	moved.Digest = "0123456789abcdef01234567"
	if keyOf(t, "portrait", plain) == keyOf(t, "portrait", moved.PortraitInput(cr.ID, cr.Tier, cr.Tags, "", nil)) {
		t.Fatal("the portrait key did not move with the kit's digest")
	}
	if _, err := render.Portrait(plain, &moved, b.Palette); err == nil {
		t.Fatal("a portrait drew with a kit its input does not name")
	}
	if _, err := render.Portrait(k.PortraitInput("no-such-archetype", 1, nil, "", nil), k, b.Palette); err != nil {
		t.Fatal("an archetype with no layers of its own did not draw:", err)
	}
}

// TestArtSlots: every slot loads and draws in palette colours only, and
// every fact finds a slot.
func TestArtSlots(t *testing.T) {
	b, k := testkit.Book(t), kit(t)
	for _, id := range k.Fills() {
		if !slices.ContainsFunc(b.Palette, func(p sheets.Palette) bool { return p.ID == id }) {
			t.Fatalf("the kit fills with %q, which the palette has not", id)
		}
	}
	reached := map[string]bool{}
	for _, slot := range render.Slots {
		if len(k.Art[slot]) == 0 {
			t.Fatalf("slot %s has no layers", slot)
		}
		c, err := render.Art(slot, k, b.Palette)
		if err != nil {
			t.Fatal(slot, err)
		}
		if r := c.Img.Bounds(); r.Dx() != 640 || r.Dy() != 200 {
			t.Fatalf("slot %s is %v", slot, r)
		}
		pngOf(t, "art-"+slot, c)
	}
	if _, err := render.Art("no-such-slot", k, b.Palette); err == nil {
		t.Fatal("an unknown slot drew")
	}
	cases := []struct{ kind, template, want string }{
		{"trouble.started", "raid", "raid"}, {"trouble.started", "fire", "fire"}, {"trouble.started", "corruption", "corruption"},
		{"trouble.started", "shortage", "shortage"}, {"trouble.started", "sickness", "sickness"}, {"trouble.started", "panic", "panic"},
		{"arc.cast", "the-siege", "siege"}, {"occasion.began", "caravan", "fair"}, {"trouble.held", "raid", "stage-held"},
		{"trouble.lost", "fire", "stage-lost"}, {"arc.stage-ended", "the-siege", "stage-held"}, {"arc.stage-ended", render.Lapsed, "stage-lost"},
		{"arc.ended", render.Lapsed, "stage-lost"}, {"season.finale", "", "finale"}, {"season.closed", "", "season-close"},
		{"beat.won", "", "day"}, {"", "", "day"},
	}
	for _, c := range cases {
		got := render.SlotFor(c.kind, c.template)
		if got != c.want {
			t.Fatalf("SlotFor(%q, %q) = %q, want %q", c.kind, c.template, got, c.want)
		}
		reached[got] = true
	}
	for _, slot := range render.Slots {
		if !reached[slot] {
			t.Fatalf("no fact reaches slot %s", slot)
		}
	}
	for _, row := range b.FactWeights {
		for _, tpl := range append([]string{"", render.Lapsed}, arcTemplates(b)...) {
			if s := render.SlotFor(row.Kind, tpl); !slices.Contains(render.Slots, s) {
				t.Fatalf("SlotFor(%q, %q) = %q", row.Kind, tpl, s)
			}
		}
	}
}

func arcTemplates(b *sheets.Book) []string {
	var out []string
	for _, a := range b.Arcs {
		out = append(out, a.ID)
	}
	for _, x := range b.Troubles {
		out = append(out, x.ID)
	}
	for _, o := range b.Occasions {
		out = append(out, o.ID)
	}
	return out
}

func count(c *render.Canvas, x0, y0, x1, y1 int, match func(color.RGBA) bool) int {
	n := 0
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			if match(c.Img.RGBAAt(x, y)) {
				n++
			}
		}
	}
	return n
}

func differ(a, b *render.Canvas, x0, y0, x1, y1 int) int {
	n := 0
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			if a.Img.RGBAAt(x, y) != b.Img.RGBAAt(x, y) {
				n++
			}
		}
	}
	return n
}

// TestBannerSettlementState: no palisade without a wall, a broken one when
// it is down or the place is ruined, fire behind the wall under a raid,
// flames in the streets under a fire, a taller skyline for a city, and the
// danger stripes kept.
func TestBannerSettlementState(t *testing.T) {
	b := testkit.Book(t)
	draw := func(name string, in render.BannerInput) *render.Canvas {
		t.Helper()
		in.Seed, in.Terrain, in.Hour, in.Settlement = "r-2", "plain", 12, true
		c, err := render.Banner(in, b.BannerLayers, b.Palette)
		if err != nil {
			t.Fatal(name, err)
		}
		pngOf(t, "banner-"+name, c)
		return c
	}
	timber := render.Hex("#5d4a37")
	isTimber := func(c color.RGBA) bool { return c == timber }
	const gy, town0, town1 = 124, 290, 620
	open := draw("open", render.BannerInput{})
	walled := draw("walled", render.BannerInput{Wall: 2})
	down := draw("wall-down", render.BannerInput{Wall: 2, WallDown: true})
	ruin := draw("ruined", render.BannerInput{Wall: 2, Ruined: true})
	if n := count(open, 0, 0, 640, 200, isTimber); n != 0 {
		t.Fatalf("a settlement without a wall drew %d palisade pixels", n)
	}
	whole := count(walled, 0, 0, 640, 200, isTimber)
	if whole == 0 {
		t.Fatal("a wall of tier 2 drew no palisade")
	}
	for name, c := range map[string]*render.Canvas{"down": down, "ruined": ruin} {
		if n := count(c, 0, 0, 640, 200, isTimber); n == 0 || n >= whole {
			t.Fatalf("a %s wall drew %d palisade pixels against %d standing", name, n, whole)
		}
	}
	if count(walled, 0, 0, 640, 200, isTimber) >= count(draw("walled-3", render.BannerInput{Wall: 3}), 0, 0, 640, 200, isTimber) {
		t.Fatal("a higher wall is not drawn taller")
	}
	raid := draw("raid", render.BannerInput{Wall: 2, Trouble: render.TroubleRaid})
	top := gy + 6 - 24 - 6*2
	if n := differ(walled, raid, town0, 0, town1, top); n < 2000 {
		t.Fatalf("a raid drew %d pixels above the wall", n)
	}
	fire := draw("fire", render.BannerInput{Wall: 2, Trouble: render.TroubleFire})
	if n := differ(walled, fire, town0, 0, town1, gy); n < 300 {
		t.Fatalf("a fire drew %d pixels in the streets", n)
	}
	if differ(raid, fire, 0, 0, 640, 200) == 0 {
		t.Fatal("a raid and a fire drew alike")
	}
	other := draw("sickness", render.BannerInput{Wall: 2, Trouble: "sickness"})
	if differ(walled, other, town0, 0, town1, gy) == 0 {
		t.Fatal("an open trouble drew nothing")
	}
	city := draw("city", render.BannerInput{Wall: 3, City: true})
	house := render.Hex("#3a3631")
	tall := func(c *render.Canvas) int {
		return count(c, town0, 0, town1, gy-8-52, func(x color.RGBA) bool { return x == house })
	}
	if tall(open) != 0 || tall(city) == 0 {
		t.Fatalf("skyline above the town's roofs: town %d, city %d", tall(open), tall(city))
	}
	danger := draw("danger", render.BannerInput{Danger: true})
	hazard := render.Hex("#e0b424")
	if count(danger, 0, 186, 640, 200, func(c color.RGBA) bool { return c == hazard }) == 0 {
		t.Fatal("danger lost its stripes")
	}
}

// TestChartAxes: the day axis is labelled, the unit sits at the top left,
// and each mark is lettered at its line's top, A, B, C in day order.
func TestChartAxes(t *testing.T) {
	for i, want := range map[int]string{0: "A", 1: "B", 25: "Z", 26: "AA", 27: "AB", 701: "ZZ", 702: "AAA"} {
		if got := render.MarkLabel(i); got != want {
			t.Fatalf("MarkLabel(%d) = %q, want %q", i, got, want)
		}
	}
	s := render.Series{Title: "saltglass at close", Unit: "coin per saltglass", XLabel: "days", Days: []int64{1, 2, 3, 4, 5, 6}, Values: []int64{10, 12, 9, 14, 13, 15}}
	s.Mark(2, 40)
	s.Mark(4, 41)
	s.Mark(5, 47)
	if got := []render.Mark{{Day: 2, Fact: 40, Label: "A"}, {Day: 4, Fact: 41, Label: "B"}, {Day: 5, Fact: 47, Label: "C"}}; !slices.Equal(s.Marks, got) {
		t.Fatalf("marks %+v", s.Marks)
	}
	c := render.Chart(s)
	pngOf(t, "chart-marked", c)
	bare := s
	bare.Marks, bare.XLabel, bare.Unit = nil, "", ""
	b := render.Chart(bare)
	pngOf(t, "chart-bare", b)
	const top, left, right, bottom = 40, 48, 628, 252
	for _, m := range s.Marks {
		x := left + (right-left)*int(m.Day-1)/5
		if differ(c, b, x-8, top-17, x+8, top) == 0 {
			t.Fatalf("mark %s on day %d has no letter at its top", m.Label, m.Day)
		}
	}
	if differ(c, b, 0, 0, 200, 18) == 0 {
		t.Fatal("no unit at the top left")
	}
	if differ(c, b, (left+right)/2-20, bottom+10, (left+right)/2+20, 300) == 0 {
		t.Fatal("no label on the day axis")
	}
}

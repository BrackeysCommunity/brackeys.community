package emerge

import (
	"bytes"
	"encoding/json"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

func filledState() *State {
	s := New(3, 1)
	d := NewDecay(10, 15)
	for _, h := range []hex.Hex{{Q: 4, R: -1}, {Q: -2, R: 7}, {Q: 4, R: -3}, {Q: 0, R: 0}} {
		sp := &Spot{Hex: h}
		sp.Count.Add(5, 1, 2, d)
		sp.Window.Add(5, 1, 2, 9)
		sp.Who.See("c-1", 5, 1, 20)
		s.Passage[h] = sp
	}
	s.Clearing[hex.Hex{Q: 1, R: 1}] = &Spot{Hex: hex.Hex{Q: 1, R: 1}, Done: "camp:2"}
	s.Pairs[PairOf(5, 2)] = &Pair{Key: PairOf(5, 2)}
	s.Pairs[PairOf(1, 9)] = &Pair{Key: PairOf(1, 9)}
	s.RoadLoad[3] = &RoadLoad{Region: 3, Tiles: map[hex.Hex]int64{{Q: 2, R: 2}: 9, {Q: -1, R: 0}: 4}, Busiest: hex.Hex{Q: 2, R: 2}}
	s.Styles[StyleKey{Region: 2, Style: "edge+keen"}] = &StyleTrace{
		Key: StyleKey{Region: 2, Style: "edge+keen"}, Resisted: "keen", Lead: "edge",
		Chars: map[string]Wins{"c-2": {1, 2}, "c-1": {3}}, Beaten: map[string]int64{"mire-stalker": 4},
	}
	s.Styles[StyleKey{Region: 0, Style: "edge-and-ember"}] = &StyleTrace{Key: StyleKey{Region: 0, Style: "edge-and-ember"}}
	s.Regions[2] = &RegionTally{Region: 2}
	s.Renown["item:i-4"] = &Subject{Ref: fact.Ref{Kind: "item", ID: "i-4"}}
	s.Masters[MastersKey{Place: 3, Family: "rewire"}] = &Recent{IDs: []Seen{{ID: "c-1", Day: 2}}}
	s.Masters[MastersKey{Place: 1, Family: "circuit"}] = &Recent{}
	s.Touch(5, DueKey{Trace: Passage, Hex: &hex.Hex{Q: 4, R: -1}})
	s.Promotions = append(s.Promotions, Promotion{ID: s.NewID(Road), Type: Road, Name: "the Ashford Road", Region: 2, At: &hex.Hex{Q: 4, R: -1}})
	s.Roads[hex.Hex{Q: 4, R: -1}] = "road:1"
	s.Roads[hex.Hex{Q: -3, R: 2}] = "road:1"
	s.RoadRecs["road:1"] = &RoadRec{ID: "road:1", Region: 2, Tiles: 2}
	s.Camps[hex.Hex{Q: 1, R: 1}] = &CampRec{ID: "camp:2", Station: "bench"}
	s.Haunts[hex.Hex{Q: 6, R: 0}] = &HauntRec{ID: "haunt:3", Lead: "reed-rat"}
	s.Routes = append(s.Routes, &RouteRec{ID: "route:4", A: 1, B: 5, Path: []hex.Hex{{Q: 0, R: 0}, {Q: 1, R: 0}}})
	s.Caravans = append(s.Caravans, &Caravan{ID: "caravan:1", Route: "route:4", From: 1, To: 5, Depart: 10, Arrive: 30})
	s.Variants = append(s.Variants, &VariantRec{ID: "variant:5", Region: 2, Archetype: "mire-stalker", Row: "plated"})
	s.Materials = append(s.Materials, sheets.Material{ID: "found.plated.stalker-hide", Tier: 2, Tags: []string{"hide", "plated"}})
	s.Legends = append(s.Legends, &LegendRec{ID: "legend:6", Of: fact.Ref{Kind: "creature", ID: "reed-rat"}})
	s.Lines["sig-a"] = &Line{Sig: "sig-a", Place: -1}
	s.Sigs["sig-b"] = &Sig{Sig: "sig-b", Streak: 2, Last: 1}
	s.Customs = append(s.Customs, &CustomRec{ID: "custom:7", Spec: []byte(`{"verb":"bring"}`)})
	s.Contests = append(s.Contests, &Contest{A: "g-1", B: "g-2", SeatA: 1, SeatB: 2})
	s.Eased[MastersKey{Place: 3, Family: "rewire"}] = true
	s.MarkStaged(42, 256)
	s.MarkStaged(43, 256)
	s.Now.Promotions[Road] = 1
	s.Tolled["c-1@road:1"] = 5
	return s
}

func TestStateJSONRoundTripSorted(t *testing.T) {
	s := filledState()
	b1, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var back State
	if err := json.Unmarshal(b1, &back); err != nil {
		t.Fatal(err)
	}
	b2, err := json.Marshal(&back)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(b1, b2) {
		t.Fatalf("round trip differs:\n%s\n%s", b1, b2)
	}
	if b3, _ := json.Marshal(back); !bytes.Equal(b1, b3) {
		t.Error("a value and a pointer marshal differently")
	}

	var wire struct {
		Passage []struct{ Hex hex.Hex }    `json:"passage"`
		Pairs   []struct{ Key PairKey }    `json:"pairs"`
		Styles  []struct{ Key StyleKey }   `json:"styles"`
		Roads   []struct{ Hex hex.Hex }    `json:"roads"`
		Masters []struct{ Key MastersKey } `json:"masters"`
	}
	if err := json.Unmarshal(b1, &wire); err != nil {
		t.Fatal(err)
	}
	var hs []hex.Hex
	for _, p := range wire.Passage {
		hs = append(hs, p.Hex)
	}
	if !slices.IsSortedFunc(hs, cmpHex) || len(hs) != 4 {
		t.Errorf("passage not sorted by (q, r): %v", hs)
	}
	if len(wire.Pairs) != 2 || wire.Pairs[0].Key != (PairKey{A: 1, B: 9}) {
		t.Errorf("pairs: %v", wire.Pairs)
	}
	if len(wire.Styles) != 2 || wire.Styles[0].Key.Region != 0 {
		t.Errorf("styles: %v", wire.Styles)
	}
	if len(wire.Roads) != 2 || wire.Roads[0].Hex != (hex.Hex{Q: -3, R: 2}) {
		t.Errorf("roads: %v", wire.Roads)
	}
	if len(wire.Masters) != 2 || wire.Masters[0].Key.Place != 1 {
		t.Errorf("masters: %v", wire.Masters)
	}

	if !back.IsStaged(42) || !back.IsStaged(43) || back.IsStaged(44) {
		t.Error("the staged set was not rebuilt")
	}
	if back.RoadLoad[3].Tiles[hex.Hex{Q: 2, R: 2}] != 9 || back.Camps[hex.Hex{Q: 1, R: 1}].Station != "bench" {
		t.Error("tile-keyed maps did not come back")
	}
	if back.Promotion("road:1") == nil || back.Styles[StyleKey{Region: 2, Style: "edge+keen"}].Chars["c-2"][1] != 2 {
		t.Error("records did not come back")
	}
}

func TestUnmarshalFillsNilMaps(t *testing.T) {
	var s State
	if err := json.Unmarshal([]byte(`{"season":2}`), &s); err != nil {
		t.Fatal(err)
	}
	if s.Passage == nil || s.Pairs == nil || s.Styles == nil || s.Roads == nil || s.Camps == nil ||
		s.Eased == nil || s.Tolled == nil || s.Now.Promotions == nil || s.Lines == nil {
		t.Fatalf("nil maps after load: %+v", s)
	}
	s.Roads[hex.Hex{}] = "road:1"
	b1, _ := json.Marshal(New(0, 0))
	var fresh State
	if err := json.Unmarshal(b1, &fresh); err != nil {
		t.Fatal(err)
	}
	if b2, _ := json.Marshal(&fresh); !bytes.Equal(b1, b2) {
		t.Errorf("a fresh state does not round trip:\n%s\n%s", b1, b2)
	}
}

func TestExpiredReturnsExactlyItsBucket(t *testing.T) {
	s := New(0, 0)
	a := DueKey{Trace: Passage, Hex: &hex.Hex{Q: 1, R: 2}}
	b := DueKey{Trace: Haulage, Pair: &PairKey{A: 1, B: 3}}
	c := DueKey{Trace: Reliance, Style: &StyleKey{Region: 1, Style: "edge+keen"}}
	s.Touch(0, a)
	s.Touch(0, b)
	s.Touch(0, a)
	s.Touch(1, c)
	s.Touch(2, a)
	if got := s.Expired(14, 15); got != nil {
		t.Fatalf("nothing is 15 days old yet: %v", got)
	}
	got := s.Expired(15, 15)
	if len(got) != 2 || got[0].id() != a.id() || got[1].id() != b.id() {
		t.Fatalf("day 0's bucket: %v", got)
	}
	if len(s.Expire) != 2 || s.Expire[0].Day != 1 {
		t.Errorf("left: %+v", s.Expire)
	}
	if again := s.Expired(15, 15); again != nil {
		t.Errorf("a second call: %v", again)
	}
	s.Touch(16, a)
	s.Touch(16, a)
	if n := len(s.Expire[len(s.Expire)-1].Keys); n != 1 {
		t.Errorf("a key listed %d times in a day", n)
	}
}

func TestTouchAfterLoadKeepsOneEntryADay(t *testing.T) {
	s := New(0, 0)
	k := DueKey{Trace: Loss, Region: 4}
	s.Touch(3, k)
	b, _ := json.Marshal(s)
	var back State
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	back.Touch(3, k)
	if n := len(back.Expire[0].Keys); n != 1 {
		t.Errorf("listed %d times after a load", n)
	}
}

func TestPromotionIDs(t *testing.T) {
	s := New(0, 0)
	for _, ty := range []Type{Road, Style, Road, Variant, Material} {
		s.Promotions = append(s.Promotions, Promotion{ID: s.NewID(ty), Type: ty})
	}
	if s.Promotions[3].ID != "variant:4" {
		t.Errorf("ids: %v", s.Promotions)
	}
	for _, p := range s.Promotions {
		if got := s.Promotion(p.ID); got == nil || got.ID != p.ID {
			t.Errorf("lookup %s: %v", p.ID, got)
		}
	}
	if s.Promotion("road:9") != nil || s.Promotion("nonsense") != nil {
		t.Error("found what is not there")
	}
	s.Promotion("style:2").Named = "Keen hands"
	if s.Promotions[1].Shown() != "Keen hands" {
		t.Error("a rename through the lookup did not stick")
	}
	if !Renamable(Style) || !Renamable(Material) || Renamable(Road) || Renamable(Custom) {
		t.Error("renamable types")
	}
}

func TestStagedRing(t *testing.T) {
	s := New(0, 0)
	for id := fact.ID(1); id <= 5; id++ {
		s.MarkStaged(id, 3)
	}
	s.MarkStaged(5, 3)
	if !slices.Equal(s.Staged, []fact.ID{3, 4, 5}) || s.IsStaged(2) || !s.IsStaged(3) {
		t.Errorf("ring: %v", s.Staged)
	}
}

func TestPayTollOnceADay(t *testing.T) {
	s := New(0, 0)
	if !s.PayToll("c-1", "road:1", 4) || s.PayToll("c-1", "road:1", 4) {
		t.Error("once a day a road")
	}
	if !s.PayToll("c-1", "road:2", 4) || !s.PayToll("c-1", "road:1", 5) {
		t.Error("another road or day is owed")
	}
	s.PayToll("c-2", "road:1", 7)
	for k, d := range s.Tolled {
		if d < 6 {
			t.Errorf("kept %s from day %d", k, d)
		}
	}
}

func TestSigRunsOfSeasons(t *testing.T) {
	var g Sig
	g.Count(1)
	g.Count(1)
	g.Count(2)
	g.Count(3)
	if g.Streak != 3 {
		t.Errorf("three running: %d", g.Streak)
	}
	g.Count(5)
	if g.Streak != 1 || g.Last != 5 {
		t.Errorf("a gap restarts: %+v", g)
	}
}

func TestMostBeaten(t *testing.T) {
	st := &StyleTrace{Beaten: map[string]int64{"reed-rat": 3, "mire-stalker": 3, "flat-runner": 1}}
	if a, ok := st.MostBeaten(); !ok || a != "mire-stalker" {
		t.Errorf("most beaten: %q", a)
	}
	if _, ok := (&StyleTrace{}).MostBeaten(); ok {
		t.Error("none beaten")
	}
}

func TestJSONFieldNamesAreDistinct(t *testing.T) {
	rt := func(in, out any) {
		b, _ := json.Marshal(in)
		if err := json.Unmarshal(b, out); err != nil {
			t.Fatal(err)
		}
	}
	var r RouteRec
	rt(RouteRec{A: 1, B: 2}, &r)
	var c Caravan
	rt(Caravan{From: 1, To: 2}, &c)
	var k Contest
	rt(Contest{A: "x", B: "y"}, &k)
	if r.A != 1 || r.B != 2 || c.From != 1 || c.To != 2 || k.A != "x" || k.B != "y" {
		t.Errorf("a field was lost: %+v %+v %+v", r, c, k)
	}
}

// The game digests its emergence state, so a filled one must encode, and
// its JSON round trip must keep the digest.
func TestFilledStateDigests(t *testing.T) {
	s := filledState()
	d, err := canon.Digest(s)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var back State
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	d2, err := canon.Digest(&back)
	if err != nil {
		t.Fatal(err)
	}
	if d != d2 {
		t.Fatal("digest moved across a JSON round trip")
	}
}

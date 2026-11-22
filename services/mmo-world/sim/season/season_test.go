package season_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
)

// The story.days bands for a 42-day season, as the design's day table sets them.
var days42 = []sheets.SeasonDay{
	{ID: season.Opening, From: 1, To: 7},
	{ID: season.Rising, From: 8, To: 28, Split: 18},
	{ID: season.Last, From: 29, To: 38},
	{ID: season.Finale, From: 39, To: 42},
}

func TestTableFor42(t *testing.T) {
	want := season.Table{
		{Band: season.Opening, From: 1, To: 7, Stage: -1},
		{Band: season.Rising, From: 8, To: 18, Stage: 0},
		{Band: season.Rising, From: 19, To: 28, Stage: 1},
		{Band: season.Last, From: 29, To: 38, Stage: 2},
		{Band: season.Finale, From: 39, To: 42, Stage: -1},
	}
	if got := season.TableFor(days42, 42, 42); !slices.Equal(got, want) {
		t.Fatalf("42 days:\n got %v\nwant %v", got, want)
	}
}

func TestTableFor14(t *testing.T) {
	want := season.Table{
		{Band: season.Opening, From: 1, To: 2, Stage: -1},
		{Band: season.Rising, From: 3, To: 6, Stage: 0},
		{Band: season.Rising, From: 7, To: 9, Stage: 1},
		{Band: season.Last, From: 10, To: 12, Stage: 2},
		{Band: season.Finale, From: 13, To: 14, Stage: -1},
	}
	got := season.TableFor(days42, 14, 42)
	if !slices.Equal(got, want) {
		t.Fatalf("14 days:\n got %v\nwant %v", got, want)
	}
	for stage, end := range []int64{6, 9, 12} {
		if e := got.StageEnds(stage); e != end {
			t.Errorf("stage %d ends on %d, want %d", stage, e, end)
		}
	}
	if got.StageEnds(3) != 0 {
		t.Error("a fourth world stage should not exist")
	}
	if got.FinaleFrom() != 13 {
		t.Errorf("finale from %d, want 13", got.FinaleFrom())
	}
	for day, band := range map[int64]string{1: season.Opening, 2: season.Opening, 3: season.Rising, 9: season.Rising, 10: season.Last, 13: season.Finale, 14: season.Finale} {
		if s := got.At(day); s.Band != band {
			t.Errorf("day %d in %s, want %s", day, s.Band, band)
		}
	}
	if s := got.At(7); s.Stage != 1 {
		t.Errorf("day 7 is in stage %d, want 1", s.Stage)
	}
	if got.At(0) != got[0] || got.At(99) != got[len(got)-1] {
		t.Error("days outside the season should clamp to the first and last spans")
	}
}

// Every span keeps a day however short the season, and the last always
// ends on the season's days.
func TestTableForKeepsADay(t *testing.T) {
	for days := int64(5); days <= 60; days++ {
		tb := season.TableFor(days42, days, 42)
		if tb[len(tb)-1].To != days {
			t.Fatalf("%d days: last span ends on %d", days, tb[len(tb)-1].To)
		}
		next := int64(1)
		for _, s := range tb {
			if s.From != next || s.To < s.From {
				t.Fatalf("%d days: span %v does not follow on from %d with a day", days, s, next)
			}
			next = s.To + 1
		}
	}
	tb := season.TableFor(days42, 3, 42)
	if tb[len(tb)-1].To != 3 || tb.FinaleFrom() != 3 {
		t.Fatalf("3 days: %v should end with a one-day finale on day 3", tb)
	}
}

func TestShippedDays(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	base := sheets.IntParam(b.StoryParams, "season-days")
	zero := sheets.IntParam(b.StoryParams, "season-zero-days")
	if got, want := season.TableFor(b.SeasonDays, base, base), season.TableFor(days42, 42, 42); base != 42 || !slices.Equal(got, want) {
		t.Errorf("shipped %d-day table %v, want %v", base, got, want)
	}
	if got, want := season.TableFor(b.SeasonDays, zero, base), season.TableFor(days42, 14, 42); zero != 14 || !slices.Equal(got, want) {
		t.Errorf("shipped %d-day table %v, want %v", zero, got, want)
	}
}

func TestClock(t *testing.T) {
	c := season.Clock{N: 0, Start: 0, Days: 14, Epoch: "d0"}
	if c.Day(0) != 1 || c.Day(13) != 14 {
		t.Fatalf("season days %d, %d", c.Day(0), c.Day(13))
	}
	for d := range int64(20) {
		if c.Closes(d) != (d == 14) {
			t.Fatalf("season 0 closes on day %d: %v", d, c.Closes(d))
		}
	}
	n := c.Next(14, 42)
	if n != (season.Clock{N: 1, Start: 14, Days: 42, Epoch: "d0"}) {
		t.Fatalf("next %+v", n)
	}
	if n.Day(14) != 1 || !n.Closes(56) || n.Closes(55) {
		t.Fatalf("season 1: day %d, closes 56 %v", n.Day(14), n.Closes(56))
	}
	legacy := season.Clock{N: 3, Start: 126, Days: 42, Legacy: true}
	if l := legacy.Next(168, 42); l.Legacy || l.N != 4 || l.Start != 168 {
		t.Fatalf("a legacy clock's next %+v", l)
	}
}

func TestLargest(t *testing.T) {
	if _, ok := season.Largest(nil, nil); ok {
		t.Fatal("no pressures should give none")
	}
	r := func(id string) fact.Ref { return fact.Ref{Kind: "region", ID: id} }
	ps := []season.Pressure{
		{Kind: "region", Ref: r("a"), Score: 300},
		{Kind: "faction", Ref: r("b"), Score: 500},
		{Kind: "settlement", Ref: r("c"), Score: 100},
		{Kind: "region", Ref: r("d"), Score: 500},
		{Kind: "region", Ref: r("e"), Score: 500},
	}
	if p, _ := season.Largest(ps[:3], func(int) int { t.Fatal("no tie to break"); return 0 }); p.Ref.ID != "b" {
		t.Fatalf("largest %v", p)
	}
	var seen int
	for k, want := range []string{"b", "d", "e", "b"} {
		p, ok := season.Largest(ps, func(n int) int { seen = n; return k })
		if !ok || p.Ref.ID != want {
			t.Fatalf("tie pick %d gave %v, want %s", k, p, want)
		}
	}
	if seen != 3 {
		t.Fatalf("the tie saw %d tied, want 3", seen)
	}
	if p, _ := season.Largest(ps, nil); p.Ref.ID != "b" {
		t.Fatalf("a nil tie should take the first tied, got %v", p)
	}
	if p, _ := season.Largest(ps, func(int) int { return -1 }); p.Ref.ID != "e" {
		t.Fatalf("a negative tie should wrap, got %v", p)
	}
}

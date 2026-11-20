package harness

import (
	"reflect"
	"testing"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

// treeBook is a book of two classes: one whose first tier has two
// abilities fights read and whose second has one, and one no fight reads.
func treeBook() *sheets.Book {
	whole := func(id string, n int64) sheets.Param { return sheets.Param{ID: id, Value: fixed.FromInt(n)} }
	return &sheets.Book{
		Classes: []sheets.Class{
			{ID: "delver", Skill: "lockpick", Tag: "delver", Unlock: []sheets.Requirement{{Kind: "practice", ID: "lockpick", At: 6}}},
			{ID: "smith", Skill: "craft", Tag: "smith"},
		},
		Abilities: []sheets.Ability{
			{ID: "light-fingers", Class: "delver", Tier: 1, Reads: "fight: lockpick options"},
			{ID: "sure-footing", Class: "delver", Tier: 1, Reads: "fight: hazard beats"},
			{ID: "mapper", Class: "delver", Tier: 5, Waits: "later", Reads: "fight: forks"},
			{ID: "pack-light", Class: "delver", Tier: 5, Reads: "the mark command; fight: leaving"},
			{ID: "thrift", Class: "smith", Tier: 1, Reads: "make: station fees"},
		},
		ClassParams: []sheets.Param{whole("active-classes", 2), whole("tier-levels", 5), whole("level-5-practice", 12), whole("level-10-practice", 16), whole("level-15-practice", 20)},
		Rules:       []sheets.RuleRow{{ID: "r", Subject: []string{"option", "light-fingers"}}},
	}
}

func TestClassBuildsTakeWhatFightsRead(t *testing.T) {
	book := treeBook()
	delver, smith := &book.Classes[0], &book.Classes[1]
	if got := variants(book, delver); got != 2 {
		t.Fatalf("delver has %d builds, want one for each of its first tier's two", got)
	}
	if got := variants(book, smith); got != 1 {
		t.Fatalf("smith has %d builds", got)
	}
	if !fights(book, delver) || fights(book, smith) {
		t.Fatalf("fights: delver %v, smith %v", fights(book, delver), fights(book, smith))
	}
	// A rule that names a class's tag makes it one fights read.
	book.Rules = append(book.Rules, sheets.RuleRow{ID: "s", Subject: []string{"creature"}, Other: []string{"smith"}})
	if !fights(book, smith) {
		t.Fatal("a rule names the smith's tag, and it still fights as the plain kit")
	}
	b := &battle{p: &Play{Book: book}}
	for _, c := range []struct {
		variant int
		level   int64
		want    []string
	}{
		{0, 1, []string{"light-fingers"}},
		{1, 1, []string{"sure-footing"}},
		{1, 5, []string{"sure-footing", "pack-light"}}, // the waiting one is never taken
		{0, 0, nil},
	} {
		if got := b.abilities(&classBuild{row: delver, variant: c.variant}, c.level); !reflect.DeepEqual(got, c.want) {
			t.Errorf("variant %d at level %d takes %v, want %v", c.variant, c.level, got, c.want)
		}
	}
	if got := b.abilities(&classBuild{row: delver, only: "mapper"}, 1); !reflect.DeepEqual(got, []string{"mapper"}) {
		t.Errorf("one ability alone: %v", got)
	}
}

func TestMatrixCellWinners(t *testing.T) {
	book := treeBook()
	c := matrixCell{loadout: make([]float64, len(loadouts)), class: []float64{0.5, 0.5}}
	for i := range c.loadout {
		c.loadout[i] = 0.5
	}
	if c.winner() != "plain" || c.classWinner(book) != "plain" {
		t.Fatalf("all level: %s, %s; the plain kit wins ties", c.winner(), c.classWinner(book))
	}
	c.loadout[2], c.class[0] = 0.6, 0.6
	if c.winner() != loadouts[2].Name || c.classWinner(book) != loadouts[2].Name {
		t.Fatalf("a class level with the best loadout: %s, %s", c.winner(), c.classWinner(book))
	}
	c.class[1] = 0.7
	if c.winner() != loadouts[2].Name || c.classWinner(book) != "smith" {
		t.Fatalf("a class ahead of every loadout: %s, %s", c.winner(), c.classWinner(book))
	}
}

func TestClassResultMedianCountsThoseWithNone(t *testing.T) {
	c := classResult{daily: 5, days: []int64{20, 24, 30}}
	if m, ok := c.median(); !ok || m != 30 {
		t.Fatalf("median = %d %v, want the third of five", m, ok)
	}
	c.daily = 8
	if _, ok := c.median(); ok {
		t.Fatal("half of eight players have no class, and there is a median")
	}
	var pooled classResult
	pooled.add(classResult{daily: 2, days: []int64{9}, first: map[string]int{"chandler": 1}, abilities: 1})
	pooled.add(classResult{daily: 1, days: []int64{4}, first: map[string]int{"chandler": 1}, abilities: 2})
	if pooled.daily != 3 || !reflect.DeepEqual(pooled.days, []int64{4, 9}) || pooled.first["chandler"] != 2 || pooled.abilities != 3 {
		t.Fatalf("pooled = %+v", pooled)
	}
}

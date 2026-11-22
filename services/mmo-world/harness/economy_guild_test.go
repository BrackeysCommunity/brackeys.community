package harness

import (
	"bytes"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
)

func TestEconomyCityTakesSeason(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	discard := func(string, ...any) {}
	at := func(size, members int, raised int64) economyResult {
		return economyResult{size: size, guild: guildResult{members: members, city: cityResult{raised: raised}}}
	}

	small := citySection(discard, b, []economyResult{at(10, 10, 0)}, economyDays)
	if !strings.HasPrefix(small.Value, unmeasured) || small.Holds || !strings.Contains(small.Value, "10 members") {
		t.Fatalf("at 10 players the row reads %+v, want a reason and no mark", small)
	}
	for _, c := range []struct {
		raised int64
		holds  bool
	}{{0, false}, {21, false}, {22, true}, {42, true}, {43, false}} {
		m := citySection(discard, b, []economyResult{at(10, 10, 0), at(cityFrom, 950, c.raised)}, economyDays)
		if m.Holds != c.holds || strings.HasPrefix(m.Value, unmeasured) {
			t.Errorf("first city on day %d: %+v, want holds %v", c.raised, m, c.holds)
		}
	}
	both := citySection(discard, b, []economyResult{at(cityFrom, 950, 30), at(10*cityFrom, 9500, 0)}, economyDays)
	if both.Holds {
		t.Fatalf("a size with no city still holds: %+v", both)
	}

	var out bytes.Buffer
	Report(&out, b, []Measured{small})
	for line := range strings.SplitSeq(out.String(), "\n") {
		if strings.Contains(line, "A city takes most of a season") && !strings.HasSuffix(line, "| – |") {
			t.Fatalf("an unmeasured row is marked: %s", line)
		}
	}
}

func TestEconomyCityShort(t *testing.T) {
	needs := []game.CityNeed{{ID: "size", Have: 12, Need: 50, Unit: "characters"}, {ID: "works", Have: 4, Need: 4, Unit: "works", Met: true}}
	if got := shortOf(needs); got != "size 12 of 50 characters" {
		t.Fatalf("shortOf = %q", got)
	}
	if got := shortOf(needs[1:]); got != "nothing" {
		t.Fatalf("shortOf with every need met = %q", got)
	}
}

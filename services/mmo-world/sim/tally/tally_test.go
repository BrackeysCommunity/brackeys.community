package tally

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/tags"
)

func TestBumpKeepsKeyOrder(t *testing.T) {
	var tl Tally
	tl.Bump("b", 2)
	tl.Bump("a", 1)
	tl.Bump("c", 3)
	tl.Bump("b", 5)
	want := Tally{{"a", 1}, {"b", 7}, {"c", 3}}
	if !slices.Equal(tl, want) {
		t.Fatalf("got %v, want %v", tl, want)
	}
}

func TestAddCountsAnyAndEachTag(t *testing.T) {
	var tl Tally
	tl.Add("kill", tags.Tag("beast"), tags.Tag("fire"))
	tl.Add("kill", tags.Tag("beast"))
	for key, want := range map[string]int64{"kill:any": 2, "kill:beast": 2, "kill:fire": 1} {
		if got := tl.Get(key); got != want {
			t.Errorf("Get(%q) = %d, want %d", key, got, want)
		}
	}
}

func TestGetMissingIsZero(t *testing.T) {
	tl := Tally{{"a", 1}}
	if got := tl.Get("b"); got != 0 {
		t.Fatalf("Get(b) = %d, want 0", got)
	}
}

func TestScoreSumsKeys(t *testing.T) {
	tl := Tally{{"a", 1}, {"b", 2}, {"c", 4}}
	if got := tl.Score([]string{"a", "c", "z"}); got != 5 {
		t.Fatalf("Score = %d, want 5", got)
	}
}

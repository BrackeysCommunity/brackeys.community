package agent

import (
	"os"
	"slices"
	"strings"
	"testing"
)

// told are the words a policy would need to play toward emergence (GDD
// 13): its traces, what they promote, and the MM10 wire names. A policy
// that names none plays MM5 to MM9 code, so whatever the closed world
// promotes it promotes unprompted.
var told = []string{
	"Emergence", "emerge", "Promot", "Style", "Pairing", "Variant", "Resist", "Adapt", "Caravan", "RoadName",
	"Haunt", "Camp", "Legend", "Custom", "Toll", "Reliance",
	"PathStoryPromotions", "PathOperatorEmergence", "ActPromoteName", "CreatureName",
}

// toldBefore are words of the list a file used before emergence for
// something else, by file. None does today; a new use still fails.
var toldBefore = map[string][]string{}

// TestAgentsNotTold reads every policy source for the words, in any case.
func TestAgentsNotTold(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	read := 0
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		read++
		lower := strings.ToLower(string(src))
		for _, w := range told {
			if strings.Contains(lower, strings.ToLower(w)) && !slices.Contains(toldBefore[name], w) {
				for i, line := range strings.Split(string(src), "\n") {
					if strings.Contains(strings.ToLower(line), strings.ToLower(w)) {
						t.Errorf("%s:%d names %q: %s", name, i+1, w, strings.TrimSpace(line))
					}
				}
			}
		}
	}
	if read == 0 {
		t.Fatal("read no policy source")
	}
}

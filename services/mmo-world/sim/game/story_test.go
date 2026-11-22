package game_test

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

// storyNilDays is how long a game saved before the director runs on.
const storyNilDays = 2

// TestPreMMSnapshotsRunWithoutStory: a snapshot saved before the director
// loads with no story at its saved digest, and two world days later it
// still has none and stands at the digest the build before the director
// reached from the same snapshot.
func TestPreMMSnapshotsRunWithoutStory(t *testing.T) {
	for _, c := range []struct{ dir, ran string }{
		{"pre-mm8a", "f2f432abe7bfb4393d6168dc8e07057ae99285d2bfdcb44978eaa76cdc804475"},
		{"pre-mm8", "0a765ef7fa7fd9606824a7d62584dbd1b3b7c88244ed588b1c749497ec172164"},
	} {
		body, err := os.ReadFile("testdata/" + c.dir + "/snapshot.json")
		if err != nil {
			t.Fatal(err)
		}
		saved, err := os.ReadFile("testdata/" + c.dir + "/digest.txt")
		if err != nil {
			t.Fatal(err)
		}
		r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("story-nil"))
		var g game.Game
		if err := json.Unmarshal(body, &g); err != nil {
			t.Fatal(err)
		}
		g.Attach(r)
		if g.Story != nil {
			t.Fatalf("%s: Attach gave a saved game a story", c.dir)
		}
		if d, err := g.Digest(); err != nil || d.String() != strings.TrimSpace(string(saved)) {
			t.Fatalf("%s digests %s (%v), saved as %s", c.dir, d, err, saved)
		}
		for range storyNilDays * sheets.TicksPerDay {
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
		}
		if g.Story != nil {
			t.Fatalf("%s: a story began with no season-start", c.dir)
		}
		if d, _ := g.Digest(); d.String() != c.ran {
			t.Fatalf("%s ran %d days to %s, the build before the director reached %s", c.dir, storyNilDays, d, c.ran)
		}
		out, err := json.Marshal(&g)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(out, []byte(`"story"`)) {
			t.Fatalf("%s saves a story key with no story", c.dir)
		}
	}
}

// TestStoryOnANewWorld: a new world starts with a story, which saves and
// loads to the same digest.
func TestStoryOnANewWorld(t *testing.T) {
	g, err := game.New(rules(t))
	if err != nil {
		t.Fatal(err)
	}
	if g.Story == nil {
		t.Fatal("a new world has no story")
	}
	for range sheets.TicksPerDay + 1 {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	d, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	var h game.Game
	if err := json.Unmarshal(out, &h); err != nil {
		t.Fatal(err)
	}
	h.Attach(rules(t))
	if h.Story == nil {
		t.Fatal("the story did not survive a save")
	}
	if d2, _ := h.Digest(); d2 != d {
		t.Fatalf("a world with a story saved and loaded digests %s, %s before", d2, d)
	}
}

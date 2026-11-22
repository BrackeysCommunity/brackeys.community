package game

import (
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

func newFork(t *testing.T, g *Game, id, key string) *Shared {
	t.Helper()
	c := mustCreate(t, g, key, "knife")
	sh := &Shared{ID: id, Members: []string{c.C.ID}}
	g.Shared = append(g.Shared, sh)
	return sh
}

// arm is the moment a context's fork machine starts, then it races.
func arm(g *Game, sh *Shared) {
	sh.Machine = &PartyMachine{Source: SourceFork, Spec: puzzle.Spec{Place: "fork-x", Beat: 1}, Seats: sh.Members, At: 1000}
	g.race(sh)
}

func TestRaceThirdContextRacesNobody(t *testing.T) {
	g := guardGame(t)
	a, b, c := newFork(t, g, "sh-a", "a"), newFork(t, g, "sh-b", "b"), newFork(t, g, "sh-c", "c")
	arm(g, a)
	arm(g, b)
	arm(g, c)
	if a.Machine.Rival != "sh-b" || b.Machine.Rival != "sh-a" || c.Machine.Rival != "" {
		t.Fatalf("rivals a=%q b=%q c=%q", a.Machine.Rival, b.Machine.Rival, c.Machine.Rival)
	}
}

func TestRaceSkipsOnlyLiveRivals(t *testing.T) {
	g := guardGame(t)
	a, b, c := newFork(t, g, "sh-a", "a"), newFork(t, g, "sh-b", "b"), newFork(t, g, "sh-c", "c")
	arm(g, a)
	arm(g, b)
	b.Machine = nil
	arm(g, c)
	if a.Machine.Rival != "sh-c" || c.Machine.Rival != "sh-a" {
		t.Fatalf("rivals a=%q c=%q", a.Machine.Rival, c.Machine.Rival)
	}
}

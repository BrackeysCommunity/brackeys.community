package game_test

import (
	"errors"
	"slices"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/game"
)

// A member who leaves the party on a dungeon's floor starts climbing out
// rather than being stranded there.
func TestPartyLeaveOnAFloorClimbs(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 2)
	testkit.Delving(t, p.g, cs, 1)
	p.act(cs[1], game.Command{Kind: game.PartyLeave})
	c := cs[1]
	if c.C.Floor == 0 {
		if c.Delving != nil || p.g.SharedOf(c) != nil {
			t.Fatalf("a leaver already at floor 0: delving %v, shared %v", c.Delving, p.g.SharedOf(c))
		}
		return
	}
	if c.Long == nil || c.Long.Kind != game.Climb {
		t.Fatalf("a leaver on floor %d holds %+v, want a climb", c.C.Floor, c.Long)
	}
	for range 400 {
		if c.Long == nil {
			break
		}
		if _, err := p.g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if c.C.Floor != 0 || p.g.SharedOf(c) != nil {
		t.Fatalf("after the climb: floor %d, shared %v", c.C.Floor, p.g.SharedOf(c))
	}
}

// A fork machine's armed time is not charged to the pick window.
func TestForkMachinePausesTheWindow(t *testing.T) {
	p := newPartyGame(t)
	h, ok := forkDungeon(p.g)
	if !ok {
		t.Skip("no dungeon with a fork machine near the first settlement")
	}
	a := p.create()
	a.C.At, a.C.Floor, a.Worked = h, 1, 1
	a.Delving = &game.Delving{Dungeon: h.Ref(), Way: -1}
	p.g.OpenFork(a, 1)
	sh := p.g.SharedOf(a)
	window := p.g.PartyWindowMs()
	armed := 5 * window
	sh.Opened = armed
	p.act(a, game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceFork}, Now: armed})
	log := solveLog(t, p.g, sh)
	now := armed + window + 1
	p.act(a, game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: game.SourceFork, Log: &log}, Now: now})
	if sh.Opened == 0 {
		t.Fatalf("the solve dropped the window")
	}
	p.refused(a, game.NotDue, game.Command{Kind: game.PartyWindow, Target: sh.ID, Now: now})
	_, err := p.g.Act(game.Command{Kind: game.PartyWindow, Target: sh.ID, Now: sh.Opened + p.g.PartyWindowMs(), Char: a.C.ID, Key: p.key()})
	var ref *game.Refused
	if errors.As(err, &ref) && ref.Code == game.NotDue {
		t.Fatalf("the window never comes: %v", err)
	}
}

// The context that lost a fork-machine race cannot arm it again.
func TestRaceLoserCannotRearm(t *testing.T) {
	p := newPartyGame(t)
	h, ok := forkDungeon(p.g)
	if !ok {
		t.Skip("no dungeon with a fork machine near the first settlement")
	}
	a, b := p.create(), p.create()
	for _, c := range []*game.Char{a, b} {
		c.C.At, c.C.Floor, c.Worked = h, 1, 1
		c.Delving = &game.Delving{Dungeon: h.Ref(), Way: -1}
		p.g.OpenFork(c, 1)
	}
	sa := p.g.SharedOf(a)
	arm := game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceFork}, Now: 1000}
	p.act(a, arm)
	p.act(b, arm)
	won := solveLog(t, p.g, sa)
	p.act(a, game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: game.SourceFork, Log: &won}, Now: 1000 + won.Stop()})
	p.refused(b, game.Used, game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceFork}, Now: 3000})
}

// A ban takes a seat out of an armed party machine by ending the
// countdown, not by renumbering the seats; the rest can arm again.
func TestBanEndsAnArmedMachine(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 3)
	sh := testkit.PartyMachineBeat(t, p.g, cs, "fuse", 4)
	p.act(cs[2], game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceParty}, Now: 1000})
	if !sh.Machine.Armed() || len(sh.Machine.Seats) != 3 {
		t.Fatalf("machine %+v", sh.Machine)
	}
	if _, err := p.g.Act(game.Command{Key: p.key(), Char: cs[0].C.ID, Kind: game.Ban, Note: "test"}); err != nil {
		t.Fatal(err)
	}
	if sh.Machine.Armed() {
		t.Fatalf("a seat left and the machine stayed armed: %+v", sh.Machine)
	}
	if slices.Contains(sh.Members, cs[0].C.ID) || len(sh.Members) != 2 {
		t.Fatalf("members %v", sh.Members)
	}
	p.act(cs[2], game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceParty}, Now: 2000})
	if !sh.Machine.Armed() || len(sh.Machine.Seats) != 2 {
		t.Fatalf("re-armed %+v", sh.Machine)
	}
}
